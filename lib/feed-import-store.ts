import type {Offer, Product} from './catalog-types';
import {minimumPriceCoverage} from './price-cycle-data.ts';
import {FeedError, type FeedRow, type indexFeedCatalog} from './retail-feed.ts';
import type {StoreId} from './stores.ts';

const publicPrefix = 'PRICE_FEED_RESULT:';
const cooldownKey = 'PRICE_FEED_RATE';
const pendingAge = 24 * 60 * 60_000;
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
  status: 'open'|'published'|'rejected';
  matched: number;
  updated: number;
  pending_review: number;
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

export async function startFeedImport(db: D1Database, store: StoreId, checkedAt: string, expected: number, parts: number) {
  if (!expected) throw new FeedError('В каталоге нет известных карточек этого магазина.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM price_feed_imports WHERE started_at < ?').bind(new Date(now-pendingAge).toISOString()),
    db.prepare('INSERT INTO price_feed_imports(id,store,checked_at,started_at,expected,parts) VALUES (?,?,?,?,?,?)')
      .bind(id,store,checkedAt,new Date(now).toISOString(),expected,parts),
  ]);
  return id;
}

export async function readFeedImport(db: D1Database, id: string) {
  const result = await db.prepare('SELECT * FROM price_feed_imports WHERE id=? AND started_at>=?')
    .bind(id,new Date(Date.now()-pendingAge).toISOString()).first<ImportState>();
  if (!result) throw new FeedError('Сеанс импорта не найден или истёк.');
  return result;
}

function preparedOffer(product: Product, previous: Offer, row: FeedRow, checkedAt: string): Stage {
  const offer: Offer = {
    store:previous.store, url:previous.url, price:row.price, checkedAt,
    status:'ok', availability:row.availability, transport:'api', identity:'verified-reference',
  };
  return {id:product.id,data:JSON.stringify(offer),price:row.price,
    baselineAt:previous.checkedAt,baselinePrice:previous.status==='ok'?previous.price:null};
}

export async function stageFeedRows(db: D1Database, batch: ImportState, part: number, rows: FeedRow[], index: CatalogIndex) {
  if (batch.status !== 'open') throw new FeedError('Сеанс импорта уже завершён.');
  if (part < batch.next_part) return batch.next_part;
  if (part !== batch.next_part || part >= batch.parts) throw new FeedError('Нарушена последовательность порций.');
  const staged: Stage[] = [];
  for (const row of rows) {
    const matched = index.match(row);
    if (matched) staged.push(preparedOffer(matched.product,matched.offer,row,batch.checked_at));
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
  await db.batch(statements);
  return part + 1;
}

export function feedImportReport(batch: ImportState) {
  return {
    store:batch.store, checkedAt:batch.checked_at, finishedAt:batch.finished_at, status:batch.status,
    expected:batch.expected, matched:batch.matched, updated:batch.updated, pendingReview:batch.pending_review,
  };
}

export async function commitFeedImport(db: D1Database, batch: ImportState) {
  if (batch.status !== 'open') return feedImportReport(batch);
  if (batch.next_part !== batch.parts) throw new FeedError('Загружены не все порции.');
  const now = new Date().toISOString();
  const bind = (query: string) => db.prepare(query).bind(batch.id);
  const key = "r.product_id || ':' || b.store";
  const review = "'PRICE_REVIEW:' || " + key;
  const ready = "b.id=? AND b.status='committing' AND r.import_id=b.id";
  const fresh = "COALESCE(p.attempt_at,r.baseline_at) < b.checked_at AND COALESCE(h.checked_at,'') < b.checked_at";
  const baseline = "CASE WHEN p.key IS NULL THEN r.baseline_price WHEN json_extract(p.data,'$.status')='ok' THEN json_extract(p.data,'$.price') END";
  const minimum = Math.ceil(batch.expected * minimumPriceCoverage);
  await db.batch([
    bind(`
      UPDATE price_feed_imports
      SET matched=(SELECT COUNT(*) FROM price_feed_rows WHERE import_id=price_feed_imports.id AND conflict=0)
      WHERE id=? AND status='open' AND next_part=parts
    `),
    db.prepare(`
      UPDATE price_feed_imports SET status=CASE WHEN matched>=? THEN 'committing' ELSE 'rejected' END, finished_at=?
      WHERE id=? AND status='open' AND next_part=parts
    `).bind(minimum,now,batch.id),
    bind(`
      UPDATE price_feed_rows SET decision=choices.decision
      FROM (
        SELECT r.product_id, CASE
          WHEN NOT (${fresh}) THEN 'old'
          WHEN abs(r.price-(${baseline})) > (${baseline})*0.5 THEN 'review'
          ELSE 'publish'
        END AS decision
        FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
        LEFT JOIN price_offers p ON p.key=${key}
        LEFT JOIN source_health h ON h.store=${review}
        WHERE ${ready} AND r.conflict=0
      ) choices
      WHERE price_feed_rows.product_id=choices.product_id
        AND price_feed_rows.import_id=(SELECT id FROM price_feed_imports WHERE status='committing')
    `),
    bind(`
      INSERT INTO price_history(product_id,store,price,checked_at)
      SELECT r.product_id,b.store,r.price,b.checked_at
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      WHERE ${ready} AND r.decision='publish'
    `),
    bind(`
      INSERT INTO price_offers(key,product_id,store,data,attempt_at,is_seed)
      SELECT ${key},r.product_id,b.store,r.data,b.checked_at,0
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      WHERE ${ready} AND r.decision='publish'
      ON CONFLICT(key) DO UPDATE SET data=excluded.data,attempt_at=excluded.attempt_at
    `),
    bind(`
      INSERT INTO source_health(store,checked_at,error)
      SELECT ${review},b.checked_at,json_object('productId',r.product_id,'offer',json(r.data),'review',json('true'))
      FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
      WHERE ${ready} AND r.decision='review'
      ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error
    `),
    bind(`
      DELETE FROM source_health WHERE store IN (
        SELECT ${review}
        FROM price_feed_rows r JOIN price_feed_imports b ON b.id=r.import_id
        WHERE ${ready} AND r.decision='publish'
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
        'store',store,'checkedAt',checked_at,'finishedAt',finished_at,'status',status,
        'expected',expected,'matched',matched,'updated',updated,'pendingReview',pending_review)
      FROM price_feed_imports WHERE id=? AND finished_at=?
      ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error
      WHERE source_health.checked_at<=excluded.checked_at
    `).bind(publicPrefix,batch.id,now),
    bind("DELETE FROM price_feed_rows WHERE import_id=? AND EXISTS (SELECT 1 FROM price_feed_imports b WHERE b.id=import_id AND b.status IN ('published','rejected'))"),
  ]);
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
  return rows.results.map(row=>JSON.parse(row.error) as ReturnType<typeof feedImportReport>);
}
