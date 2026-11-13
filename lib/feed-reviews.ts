import type {Offer} from './catalog-types';
import type {StoreId} from './stores.ts';

export const feedReviewAge = 7 * 86_400_000;
const feedReviewFilter = `store GLOB 'PRICE_REVIEW:*' AND json_valid(error)`;
const firstSeen = "COALESCE(json_extract(error,'$.firstAt'),checked_at)";

type ReviewRow = {store:string;checked_at:string;error:string};

function parseReview(row: ReviewRow) {
  const data = JSON.parse(row.error) as {productId:string;offer:Offer;firstAt?:string};
  return {productId:data.productId,offer:data.offer,checkedAt:row.checked_at,firstAt:data.firstAt ?? row.checked_at};
}

export function expiredFeedReviews(db: D1Database, now: number) {
  return db.prepare(`DELETE FROM source_health WHERE ${feedReviewFilter} AND ${firstSeen}<=?`)
    .bind(new Date(now-feedReviewAge).toISOString());
}

export async function listFeedReviews(db: D1Database, after: string, now = Date.now()) {
  const {results} = await db.prepare(`SELECT store,checked_at,error FROM source_health
    WHERE ${feedReviewFilter} AND ${firstSeen}>? AND store>? ORDER BY store LIMIT 101`)
    .bind(new Date(now-feedReviewAge).toISOString(),after).all<ReviewRow>();
  const page = results.slice(0,100);
  return {reviews:page.map(parseReview),nextCursor:results.length>100 ? page.at(-1)?.store : null};
}

export async function moderateFeedReview(db: D1Database, input: {
  store:StoreId;productId:string;checkedAt:string;action:'accept'|'reject';
}, now = Date.now()) {
  const key = input.productId+':'+input.store;
  const reviewKey = 'PRICE_REVIEW:'+key;
  const row = await db.prepare(`SELECT store,checked_at,error FROM source_health
    WHERE store=? AND checked_at=? AND ${feedReviewFilter} AND ${firstSeen}>?`)
    .bind(reviewKey,input.checkedAt,new Date(now-feedReviewAge).toISOString()).first<ReviewRow>();
  if (!row) return false;

  const remove = db.prepare('DELETE FROM source_health WHERE store=? AND checked_at=?').bind(reviewKey,input.checkedAt);
  if (input.action === 'reject') {
    await remove.run();
    return true;
  }

  const {offer} = parseReview(row);
  if (offer.status !== 'ok' || typeof offer.price !== 'number' || offer.price <= 0) return false;
  const previous = await db.prepare('SELECT attempt_at,data FROM price_offers WHERE key=?')
    .bind(key).first<{attempt_at:string;data:string}>();
  if (previous && previous.attempt_at >= offer.checkedAt) return false;
  const statements = [];
  if (!previous || (JSON.parse(previous.data) as Offer).price !== offer.price) {
    statements.push(db.prepare('INSERT INTO price_history(product_id,store,price,checked_at) VALUES (?,?,?,?)')
      .bind(input.productId,input.store,offer.price,offer.checkedAt));
  }
  statements.push(db.prepare(`
    INSERT INTO price_offers(key,product_id,store,data,attempt_at,is_seed) VALUES (?,?,?,?,?,0)
    ON CONFLICT(key) DO UPDATE SET data=excluded.data,attempt_at=excluded.attempt_at
  `).bind(key,input.productId,input.store,JSON.stringify(offer),offer.checkedAt),remove);
  await db.batch(statements);
  return true;
}
