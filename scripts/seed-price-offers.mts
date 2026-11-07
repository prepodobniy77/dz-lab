import {readFile, writeFile} from 'node:fs/promises';
import {desktopCatalog} from '../lib/catalog-scope.ts';
import {knownPriceObservations, parsePriceFeed} from '../lib/price-feed.ts';
import type {CatalogData} from '../lib/catalog-types.ts';

const [output, previousFeedPath] = process.argv.slice(2);
if (!output) throw new Error('Укажи путь для SQL: node scripts/seed-price-offers.mts <output.sql> [предыдущий-прайс.json]');
const raw = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8')) as CatalogData;
const catalog = desktopCatalog(raw);
const sqlString = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const tuple = (values: string[]) => '(' + values.map(sqlString).join(',') + ',1)';
const offers = new Map<string, [string, string, string, string, string]>();
for (const product of catalog.products) {
  for (const offer of product.offers) {
    const checked = Date.parse(offer.checkedAt);
    if (!Number.isFinite(checked)) throw new Error('Некорректный checkedAt: ' + product.id);
    const key = product.id + ':' + offer.store;
    const previous = offers.get(key);
    if (!previous || checked > Date.parse(previous[4])) {
      offers.set(key, [key, product.id, offer.store, JSON.stringify(offer), offer.checkedAt]);
    }
  }
}
const rows = [...offers.values()];
const statements: string[] = [];
for (let i = 0; i < rows.length; i += 50) {
  const chunk = rows.slice(i, i + 50);
  statements.push('INSERT INTO price_offers (key,product_id,store,data,attempt_at,is_seed) VALUES\n' +
    chunk.map(tuple).join(',\n') + '\nON CONFLICT(key) DO NOTHING;');

}
if (previousFeedPath) {
  const feed = parsePriceFeed(JSON.parse(await readFile(previousFeedPath, 'utf8')));
  if (!feed || feed.source === 'd1') throw new Error('Нужен публичный снимок цен до перехода на D1.');
  const observations = knownPriceObservations(catalog, feed);
  for (let i = 0; i < observations.length; i += 50) {
    const rows = observations.slice(i, i + 50).map(({productId, offer}) =>
      '(' + [productId + ':' + offer.store, productId, offer.store, JSON.stringify(offer), offer.checkedAt]
        .map(sqlString).join(',') + ',0)',
    );
    statements.push('INSERT INTO price_offers (key,product_id,store,data,attempt_at,is_seed) VALUES\n' +
      rows.join(',\n') + '\nON CONFLICT(key) DO UPDATE SET data=excluded.data,attempt_at=excluded.attempt_at,is_seed=0 ' +
      'WHERE excluded.attempt_at > price_offers.attempt_at;');
  }
  if (observations.length) {
    statements.push("INSERT INTO source_health (store,checked_at,error) VALUES ('PRICE_IMPORTED_FEED'," +
      sqlString(feed.report.checkedAt) + ',' + sqlString(JSON.stringify(feed.report)) + ') ' +
      'ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error ' +
      'WHERE excluded.checked_at > source_health.checked_at;');
  }
  console.log('Переносится прежних наблюдений: ' + observations.length);
}
await writeFile(output, statements.join('\n') + '\n');
console.log('Подготовлено предложений: ' + rows.length);
