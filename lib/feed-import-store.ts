import type {Offer, Product} from './catalog-types';
import {expiredFeedReviews, feedReviewAge} from './feed-reviews.ts';
import {minimumPriceCoverage} from './price-cycle-data.ts';
import {FeedError, type FeedRow, type indexFeedCatalog} from './retail-feed.ts';
import type {StoreId} from './stores.ts';

const publicPrefix = 'PRICE_FEED_RESULT:';
const cooldownKey = 'PRICE_FEED_RATE';
const openAge = 2 * 60 * 60_000;
const retentionAge = 7 * 24 * 60 * 60_000;
export const feedCooldown = 60;

export type ImportState = {
  id: string;
  store: StoreId;
  checked_at: string;
  started_at: string;
  finished_at: string | null;
  expected: number;
  parts: number;
  next_part: number;
  status: 'open'|'publishing'|'published'|'rejected'|'abandoned';
  matched: number;
  updated: number;
  pending_review: number;
  fingerprint: string|null;
  rows_written: number;
  bootstrap: number;
  forced: number;
  conflicts: number;
  recognized: number;
};
type CatalogIndex = ReturnType<typeof indexFeedCatalog>;
type Stage = {id:string; data:string; price:number; baselineAt:string; baselinePrice:number|null};

export async function reserveFeedImport(db: D1Database, now = Date.now()) {
  const checked = new Date(now).toISOString();
  const latest = new Date(now - feedCooldown * 1000).toISOString();
  const result = await db.prepare(`
    INSERT INTO source_health(store,checked_at) VALUES (?,?)
    ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at
    WHERE source_health.checked_at<=?
  `).bind(cooldownKey,checked,latest).run();
  return Boolean(result.meta.changes);
}

export class FeedConflictError extends FeedError {
  readonly session: ImportState;
  constructor(session: ImportState) {
    super('Для магазина уже открыт импорт.');
    this.session = session;
  }
}

export class FeedRateError extends FeedError {}

function countWrites(results: D1Result[]) {
  return results.reduce((sum,result) => sum + (result.meta.rows_written ?? result.meta.changes ?? 0),0);
}

async function recordWrites(db: D1Database, id: string, writes: number) {
  if (writes) await db.prepare('UPDATE price_feed_imports SET rows_written=rows_written+? WHERE id=?').bind(writes,id).run();
}

export function feedImportExpired(batch: ImportState, now = Date.now()) {
  return (batch.status === 'open' || batch.status === 'publishing') && now-Date.parse(batch.started_at)>=openAge;
}

export async function cleanupFeedImports(db: D1Database, now = Date.now()) {
  return countWrites(await db.batch([
    db.prepare(`UPDATE price_feed_imports SET status='abandoned',finished_at=?
      WHERE status IN ('open','publishing') AND started_at<=?`)
      .bind(new Date(now).toISOString(),new Date(now-openAge).toISOString()),
    db.prepare(`DELETE FROM price_feed_rows WHERE import_id IN
      (SELECT id FROM price_feed_imports WHERE status='abandoned')`),
    db.prepare('DELETE FROM price_feed_imports WHERE finished_at<=?').bind(new Date(now-retentionAge).toISOString()),
    expiredFeedReviews(db,now),
  ]));
}

type StartOptions = {fingerprint?:string; rateLimit?:boolean; now?:number; bootstrap?:boolean; force?:boolean};

export async function startFeedImport(db: D1Database, store: StoreId, checkedAt: string, expected: number, parts: number,
  {fingerprint,rateLimit,now = Date.now(),bootstrap = false,force = false}: StartOptions = {}) {
  const active = () => db.prepare("SELECT * FROM price_feed_imports WHERE store=? AND status IN ('open','publishing')")
    .bind(store).first<ImportState>();
  const cleanupWrites = await cleanupFeedImports(db,now);
  const previous = await active();
  if (previous) throw new FeedConflictError(previous);
  const useBootstrap = expected < 100;
  if (useBootstrap && !bootstrap) throw new FeedError('В каталоге меньше 100 известных позиций магазина. Нужен bootstrap=1.');
  if (fingerprint) {
    const finished = await db.prepare(`SELECT id FROM price_feed_imports
      WHERE store=? AND fingerprint=? AND status IN ('published','rejected') ORDER BY finished_at DESC LIMIT 1`)
      .bind(store,fingerprint).first<{id:string}>();
    if (finished) return finished.id;
  }
  if (rateLimit && !await reserveFeedImport(db,now)) throw new FeedRateError('Следующий импорт можно начать через минуту.');
  const id = crypto.randomUUID();
  const started = await db.prepare(`INSERT INTO price_feed_imports(id,store,checked_at,started_at,expected,parts,fingerprint,rows_written,bootstrap,forced)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(id,store,checkedAt,new Date(now).toISOString(),expected,parts,fingerprint ?? null,cleanupWrites,
      Number(useBootstrap),Number(force)).run();
  if (!started.meta.changes) {
    const conflicting = await active();
    if (conflicting) throw new FeedConflictError(conflicting);
    throw new FeedError('Не удалось открыть импорт. Повтори запрос.');
  }
  await recordWrites(db,id,countWrites([started]) + Number(Boolean(rateLimit)));
  return id;
}

export async function readFeedImport(db: D1Database, id: string) {
  const result = await db.prepare('SELECT * FROM price_feed_imports WHERE id=?').bind(id).first<ImportState>();
  if (!result) throw new FeedError('Сеанс импорта не найден или истёк.');
  return result;
}

function preparedOffer(product: Product, previous: Offer, row: FeedRow, checkedAt: string, validPrice: boolean): Stage {
  const price = validPrice ? row.price : null;
  const link = new URL(row.url || previous.url);
  link.hash = '';
  // Keep product query parameters for other stores, where they may identify a variant.
  if (previous.store==='DNS') link.search = '';
  const offer: Offer = {
    store:previous.store, url:link.href, sku:previous.sku || row.sku || undefined, price, checkedAt,
    status:'ok', availability:row.availability, transport:'api', identity:'verified-reference',
  };
  const retailReference = previous.store==='DNS' ? link.pathname.split('/')[2]?.toLowerCase() : link.href;
  return {id:product.id,data:JSON.stringify({...offer,retailReference}),price:price ?? 0,
    baselineAt:previous.checkedAt,baselinePrice:previous.status==='ok'?previous.price:null};
}

export async function stageFeedRows(db: D1Database, batch: ImportState, part: number, rows: FeedRow[], index: CatalogIndex) {
  if (part < batch.next_part && batch.status !== 'abandoned') return batch.next_part;
  if (batch.status !== 'open') throw new FeedError('Сеанс импорта уже завершён.');
  if (part !== batch.next_part || part >= batch.parts) throw new FeedError('Нарушена последовательность порций.');
  const staged: Stage[] = [];
  for (const row of rows) {
    const matched = index.match(row,{bootstrap:Boolean(batch.bootstrap),includeInvalid:true});
    if (matched) staged.push(preparedOffer(matched.product,matched.offer,row,batch.checked_at,matched.validPrice));
  }
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < staged.length; i += 500) {
    statements.push(db.prepare(`
      INSERT INTO price_feed_rows(import_id,product_id,data,price,baseline_at,baseline_price)
      SELECT b.id, json_extract(j.value,'$.id'), json_extract(j.value,'$.data'),
             json_extract(j.value,'$.price'), json_extract(j.value,'$.baselineAt'), json_extract(j.value,'$.baselinePrice')
      FROM price_feed_imports b CROSS JOIN json_each(?) j
      WHERE b.id=? AND b.status='open' AND b.next_part=?
      ON CONFLICT(import_id,product_id) DO UPDATE SET conflict=1
      WHERE price_feed_rows.data <> excluded.data AND price_feed_rows.conflict=0
    `).bind(JSON.stringify(staged.slice(i,i+500)),batch.id,part));
  }
  statements.push(db.prepare("UPDATE price_feed_imports SET next_part=next_part+1 WHERE id=? AND status='open' AND next_part=?")
    .bind(batch.id,part));
  await recordWrites(db,batch.id,countWrites(await db.batch(statements)));
  return part + 1;
}

export function feedImportReport(batch: ImportState) {
  return {
    store:batch.store, checkedAt:batch.checked_at, finishedAt:batch.finished_at, status:batch.status,
    expected:batch.expected, matched:batch.matched, updated:batch.updated, pendingReview:batch.pending_review, rowsWritten:batch.rows_written,
    bootstrap:Boolean(batch.bootstrap), forced:Boolean(batch.forced), recognized:batch.recognized, conflicts:batch.conflicts,
    ...(batch.status==='rejected'?{reason:batch.matched?'coverage_below_80_percent':'no_valid_offers'}:{}),
  };
}

export async function commitFeedImport(db: D1Database, batch: ImportState) {
  if (batch.status !== 'open' && batch.status !== 'publishing') return feedImportReport(batch);
  if (batch.next_part !== batch.parts) throw new FeedError('Загружены не все порции.');
  const claimed = await db.prepare("UPDATE price_feed_imports SET status='publishing' WHERE id=? AND status='open' AND next_part=parts")
    .bind(batch.id).run();
  await recordWrites(db,batch.id,countWrites([claimed]));
  const now = new Date().toISOString();
  const bind = (query: string) => db.prepare(query).bind(batch.id);
  const key = "r.product_id || ':' || b.store";
  const review = "'PRICE_REVIEW:' || " + key;
  const ready = "b.id=? AND b.status='committing' AND r.import_id=b.id";
  const fresh = "COALESCE(p.attempt_at,r.baseline_at) < b.checked_at AND COALESCE(h.checked_at,'') < b.checked_at";
  const firstReviewAt = "COALESCE(json_extract(h.error,'$.firstAt'),h.checked_at)";
  const reviewThreshold = new Date(Date.parse(now)-feedReviewAge).toISOString();
  const jump = "json_extract(h.error,'$.offer.price')";
  const baseline = "CASE WHEN p.key IS NULL THEN r.baseline_price WHEN json_extract(p.data,'$.status')='ok' THEN json_extract(p.data,'$.price') END";

  // The set-based publication stays within one transactional D1 batch at any feed size.
  const results = await db.batch([
    bind(`
      UPDATE price_feed_rows SET conflict=1
      WHERE import_id=?1 AND conflict=0
        AND EXISTS (SELECT 1 FROM price_feed_imports WHERE id=?1 AND bootstrap=1 AND status='publishing')
        AND json_extract(data,'$.retailReference') IN (
          SELECT json_extract(data,'$.retailReference') FROM price_feed_rows
          WHERE import_id=?1 GROUP BY 1 HAVING count(*)>1
        )
    `),
    bind(`
      UPDATE price_feed_imports
      SET matched=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id AND conflict=0 AND price>0),
        recognized=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id),
        conflicts=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id AND conflict=1)
      WHERE id=? AND status='publishing' AND next_part=parts
    `),
    db.prepare(`
      UPDATE price_feed_imports SET status=CASE
        WHEN matched>0 AND (forced=1 OR matched >= ? * CASE WHEN bootstrap=1 THEN recognized ELSE expected END)
          THEN 'committing' ELSE 'rejected' END, finished_at=?
      WHERE id=? AND status='publishing' AND next_part=parts
    `).bind(minimumPriceCoverage,now,batch.id),
    db.prepare(`
      UPDATE price_feed_rows SET decision=choices.decision
      FROM (
        SELECT r.import_id,r.product_id, CASE
          WHEN NOT (${fresh}) THEN 'old'
          WHEN abs(r.price-(${baseline})) > (${baseline})*0.5 THEN
            CASE WHEN ${firstReviewAt}>? AND abs(r.price-(${jump}))<=(${jump})*0.02
              AND json_extract(h.error,'$.feedImportId') IS NOT NULL AND h.checked_at=(
                SELECT max(previous.checked_at) FROM price_feed_imports previous
                WHERE previous.store=b.store AND previous.status='published'
              ) THEN 'publish' ELSE 'review' END
          WHEN p.key IS NOT NULL AND json_extract(p.data,'$.status')='ok'
            AND json_extract(p.data,'$.price')=r.price
            AND json_extract(p.data,'$.availability') IS json_extract(r.data,'$.availability')
            AND json_extract(p.data,'$.url')=json_extract(r.data,'$.url')
              THEN CASE WHEN h.store IS NOT NULL THEN 'clear' ELSE 'same' END
          ELSE 'publish'
        END AS decision
        FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
        LEFT JOIN price_offers p ON p.key=${key}
        LEFT JOIN source_health h ON h.store=${review}
        WHERE ${ready} AND r.conflict=0 AND r.price>0
      ) choices
      WHERE price_feed_rows.product_id=choices.product_id
        AND choices.decision NOT IN ('old','same')
        AND price_feed_rows.import_id=choices.import_id
    `).bind(reviewThreshold,batch.id),
    bind(`
      INSERT INTO price_history(product_id,store,price,checked_at)
      SELECT r.product_id,b.store,r.price,b.checked_at
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      LEFT JOIN price_offers p ON p.key=${key}
      WHERE ${ready} AND r.decision='publish' AND r.price IS NOT (${baseline})
    `),
    bind(`
      INSERT INTO price_offers(key,product_id,store,data,attempt_at,is_seed)
      SELECT ${key},r.product_id,b.store,json_remove(r.data,'$.retailReference'),b.checked_at,0
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      WHERE ${ready} AND r.decision='publish'
      ON CONFLICT(key) DO UPDATE SET data=excluded.data,attempt_at=excluded.attempt_at
    `),
    db.prepare(`
      INSERT INTO source_health(store,checked_at,error)
      SELECT ${review},b.checked_at,json_object('productId',r.product_id,'offer',json_remove(r.data,'$.retailReference'),
        'review',json('true'),'feedImportId',b.id,'firstAt',
        CASE WHEN ${firstReviewAt}>? THEN ${firstReviewAt} ELSE b.finished_at END)
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      LEFT JOIN source_health h ON h.store=${review}
      WHERE ${ready} AND r.decision='review'
      ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error
    `).bind(reviewThreshold,batch.id),
    bind(`
      DELETE FROM source_health WHERE store IN (
        SELECT ${review}
        FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
        WHERE ${ready} AND r.decision IN ('publish','clear')
      )
    `),
    bind(`
      UPDATE price_feed_imports SET status='published',
        updated=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id AND decision='publish'),
        pending_review=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id AND decision='review')
      WHERE id=? AND status='committing'
    `),
    db.prepare(`
      INSERT INTO source_health(store,checked_at,error)
      SELECT ? || store,finished_at,json_object(
        'store',store,'finishedAt',finished_at,'status',status,'updated',updated)
      FROM price_feed_imports WHERE id=? AND finished_at=?
      ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error
      WHERE source_health.checked_at<=excluded.checked_at
    `).bind(publicPrefix,batch.id,now),
    bind("DELETE FROM price_feed_rows WHERE import_id=? AND EXISTS (SELECT 1 FROM price_feed_imports b WHERE b.id=import_id AND b.status IN ('published','rejected'))"),
  ]);
  await recordWrites(db,batch.id,countWrites(results));
  return feedImportReport(await readFeedImport(db,batch.id));
}

export async function publicFeedImports(db: D1Database) {
  const rows = await db.prepare(`
    SELECT h.error FROM source_health h
    WHERE h.store GLOB 'PRICE_FEED_RESULT:*' AND EXISTS (
      SELECT 1 FROM price_offers p
      WHERE p.store=substr(h.store,?) AND json_extract(p.data,'$.status')='ok'
        AND typeof(json_extract(p.data,'$.price')) IN ('integer','real') AND json_extract(p.data,'$.price')>0
    ) ORDER BY h.store
  `).bind(publicPrefix.length+1).all<{error:string}>();
  return rows.results.map(row => {
    const {store,finishedAt,status,updated} = JSON.parse(row.error) as ReturnType<typeof feedImportReport>;
    return {store,finishedAt,status,updated};
  });
}

export async function privateFeedImports(db: D1Database) {
  const {results} = await db.prepare('SELECT * FROM price_feed_imports ORDER BY started_at DESC LIMIT 30').all<ImportState>();
  return results.map(batch => ({id:batch.id,nextPart:batch.next_part,parts:batch.parts,...feedImportReport(batch)}));
}
