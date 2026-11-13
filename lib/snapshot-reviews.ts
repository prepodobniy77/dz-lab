import type {StagedPrice} from './price-cycle-data';
import type {StoreId} from './stores';

type Pending = StagedPrice & {cycleId?:string;firstAt?:string};
export function repeatedJump(candidate:StagedPrice,pending:Pending|undefined,lastCycleId:string|undefined,
  cycleId:string,now:number) {
  return Boolean(candidate.review && pending?.cycleId && pending.cycleId===lastCycleId && pending.cycleId!==cycleId &&
    Date.parse(candidate.offer.checkedAt)>Date.parse(pending.offer.checkedAt) &&
    now-Date.parse(pending.firstAt??pending.offer.checkedAt)<7*86400000 &&
    typeof pending.offer.price==='number'&&pending.offer.price>0&&typeof candidate.offer.price==='number'&&
    Math.abs(candidate.offer.price-pending.offer.price)/pending.offer.price<=0.02);
}
/** Review decisions and the caller's cursor are committed in the same transaction. */
export async function prepareSnapshotReviews(db:D1Database,chunk:StagedPrice[],cycleId:string,now:number) {
  const stores = [...new Set(chunk.map(v=>v.offer.store))];
  const pending = new Map<string,Pending>();
  const lastCycles = new Map<StoreId,string>();
  if (stores.length) {
    const {results} = await db.prepare(`SELECT store,error FROM source_health WHERE
      store GLOB 'PRICE_REVIEW:*' OR store GLOB 'PRICE_SOURCE_CYCLE:*'`).all<{store:string;error:string}>();
    for (const row of results) {
      try {
        if (row.store.startsWith('PRICE_SOURCE_CYCLE:')) lastCycles.set(row.store.slice(19) as StoreId,JSON.parse(row.error).cycleId);
        else pending.set(row.store,JSON.parse(row.error));
      } catch { /* Invalid historic metadata cannot confirm a price. */ }
    }
  }
  const published:StagedPrice[] = [],review:StagedPrice[] = [],statements:D1PreparedStatement[] = [];
  const removed:string[]=[],upserted:{key:string;checkedAt:string;data:string}[]=[];
  for (const candidate of chunk) {
    const key = 'PRICE_REVIEW:'+candidate.productId+':'+candidate.offer.store;
    const previous = pending.get(key);
    if (!candidate.review || repeatedJump(candidate,previous,lastCycles.get(candidate.offer.store),cycleId,now)) {
      published.push({...candidate,review:false});
      removed.push(key);
    } else {
      review.push(candidate);
      const firstAt = previous?.firstAt??previous?.offer.checkedAt;
      upserted.push({key,checkedAt:candidate.offer.checkedAt,data:JSON.stringify({...candidate,cycleId,
          firstAt:firstAt&&now-Date.parse(firstAt)<7*86400000?firstAt:new Date(now).toISOString()})});
    }
  }
  if(removed.length)statements.push(db.prepare('DELETE FROM source_health WHERE store IN (SELECT value FROM json_each(?))').bind(JSON.stringify(removed)));
  if(upserted.length)statements.push(db.prepare(`INSERT INTO source_health(store,checked_at,error) SELECT json_extract(value,'$.key'),json_extract(value,'$.checkedAt'),json_extract(value,'$.data') FROM json_each(?) WHERE true ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error`).bind(JSON.stringify(upserted)));
  statements.push(db.prepare(`DELETE FROM source_health WHERE store GLOB 'PRICE_REVIEW:*'
    AND json_valid(error) AND COALESCE(json_extract(error,'$.firstAt'),checked_at)<=?`)
    .bind(new Date(now-7*86400000).toISOString()));
  return {published,review,statements};
}
