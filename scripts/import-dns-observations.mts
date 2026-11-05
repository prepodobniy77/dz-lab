import {readFile, writeFile, rename, mkdir, open, unlink} from 'node:fs/promises';
import {isAllowedStoreUrl} from '../lib/stores.ts';
import type {CatalogData, Offer} from '../lib/catalog-types.ts';

type Observation = {
  source_title: string;
  mpn?: string | null;
  price: number;
  currency: string;
  url: string;
  checkedAt: string;
  is_available: boolean | null;
};
const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass a JSON file exported from verified public DNS browser observations');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
if (input.source !== 'public-browser' || input.region !== 'Москва' || !Array.isArray(input.items)) {
  throw new Error('Expected public-browser observations for Moscow');
}
await mkdir('.sites-runtime', {recursive: true});
const lockPath = '.sites-runtime/all-stores-prices.lock';
const lock = await open(lockPath, 'wx').catch(() => {throw new Error('A price refresh already holds '+lockPath)});
try {
  const data: CatalogData = JSON.parse(await readFile('data/catalog.json', 'utf8'));
  const normal = (value: string) => value.trim().toUpperCase();
  const productCode = (url: string) => new URL(url).pathname.match(/^\/product\/([a-f0-9]{16})\//)?.[1];
  const now = Date.now();
  const imported: {productId: string; price: number; url: string}[] = [];
  const review: {url: string; reason: string}[] = [];
  const seen = new Set<string>();
  for (const row of input.items as Observation[]) {
    if (!row || typeof row.url !== 'string' || !isAllowedStoreUrl(row.url, 'DNS') || !productCode(row.url)) {
      throw new Error('An observation has an invalid DNS product URL');
    }
    const url = new URL(row.url);
    const checked = Date.parse(row.checkedAt);
    if (url.search || url.hash || !Number.isFinite(checked) || now - checked > 86400000 || checked > now + 300000) {
      throw new Error('An observation has an invalid URL or is older than 24 hours');
    }
    if (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 100 || row.price > 2000000 || row.currency !== 'RUB') {
      throw new Error('Invalid RUB price');
    }
    if (typeof row.source_title !== 'string' || !row.source_title.trim() || row.mpn != null && typeof row.mpn !== 'string') {
      throw new Error('Invalid product identity');
    }
    if (row.is_available !== null && typeof row.is_available !== 'boolean') throw new Error('Invalid availability');
    // Existing DNS UUIDs are verified references. New pages require an exact MPN.
    const matches = data.products.filter(p => row.mpn
      ? normal(p.mpn) === normal(row.mpn)
      : p.offers.some(o => o.store === 'DNS' && productCode(o.url) === productCode(row.url)));
    if (matches.length !== 1) {
      review.push({url: row.url, reason: 'No unique exact MPN or existing DNS product reference'});
      continue;
    }
    const product = matches[0];
    if (seen.has(product.id)) throw new Error('Duplicate DNS observation for one product');
    seen.add(product.id);
    const previous = product.offers.find(o => o.store === 'DNS');
    if (previous && Date.parse(previous.checkedAt) > checked) continue;
    if (previous?.price && Math.abs(row.price - previous.price) / previous.price > 0.5) {
      review.push({url: row.url, reason: 'Price changed by more than 50%'});
      continue;
    }
    const offer: Offer = {
      store: 'DNS', url: row.url, price: row.price, checkedAt: row.checkedAt,
      availability: row.is_available === true ? 'in-stock' : row.is_available === false ? 'out-of-stock' : 'unknown',
      status: 'ok', transport: 'html-snapshot', identity: row.mpn ? 'mpn' : 'verified-reference',
    };
    product.offers = product.offers.filter(o => o.store !== 'DNS');
    product.offers.push(offer);
    imported.push({productId: product.id, price: row.price, url: row.url});
  }
  if (imported.length) {
    const source = data.sources.find(s => s.name === 'DNS');
    if (source) {
      source.status = 'partial';
      source.checkedAt = new Date(now).toISOString();
      source.note = `Москва. Проверены цены ${imported.length} товаров. Охват неполный.`;
    }
    await writeFile('data/catalog.json.tmp', JSON.stringify(data, null, 2) + '\n');
    await rename('data/catalog.json.tmp', 'data/catalog.json');
  }
  console.log(JSON.stringify({imported, review}, null, 2));
} finally {
  await lock.close();
  await unlink(lockPath);
}
