import type {Offer} from './catalog-types';
/** Timestamp updates are evidence; history contains only price changes. Replay is a no-op. */
export function offerWriteStatements(db:D1Database,offers:{productId:string;offer:Offer}[]) {
  const statements:D1PreparedStatement[] = [];
  for (let start=0;start<offers.length;start+=100) {
    const rows = JSON.stringify(offers.slice(start,start+100));
    statements.push(db.prepare(`INSERT INTO price_history(product_id,store,price,checked_at)
      SELECT json_extract(j.value,'$.productId'),json_extract(j.value,'$.offer.store'),
        json_extract(j.value,'$.offer.price'),json_extract(j.value,'$.offer.checkedAt')
      FROM json_each(?) j LEFT JOIN price_offers p ON p.key=
        json_extract(j.value,'$.productId')||':'||json_extract(j.value,'$.offer.store')
      WHERE json_extract(j.value,'$.offer.status')='ok' AND json_extract(j.value,'$.offer.price')>0
        AND (p.key IS NULL OR p.attempt_at<json_extract(j.value,'$.offer.checkedAt'))
        AND (p.key IS NULL OR json_extract(p.data,'$.price') IS NOT json_extract(j.value,'$.offer.price'))`).bind(rows));
    statements.push(db.prepare(`INSERT INTO price_offers(key,product_id,store,data,attempt_at)
      SELECT json_extract(j.value,'$.productId')||':'||json_extract(j.value,'$.offer.store'),
        json_extract(j.value,'$.productId'),json_extract(j.value,'$.offer.store'),
        json_extract(j.value,'$.offer'),json_extract(j.value,'$.offer.checkedAt')
      FROM json_each(?) j WHERE true
      ON CONFLICT(key) DO UPDATE SET data=excluded.data,attempt_at=excluded.attempt_at
      WHERE excluded.attempt_at>price_offers.attempt_at`).bind(rows));
  }
  return statements;
}
