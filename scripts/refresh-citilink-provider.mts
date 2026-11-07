import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAllowedStoreUrl} from '../lib/stores.ts';
import type {CatalogData, Offer, Product} from '../lib/catalog-types';
import type {StoreRefresh} from '../lib/price-feed.ts';

type PartnerFeed = {checkedAt:string;rows:{sku:string;price:number;available:boolean}[]};
const run = promisify(execFile);

export async function refreshCitilinkFeed(
  catalog: CatalogData, url: string, report: StoreRefresh,
  record: (product: Product, offer: Offer) => void,
): Promise<void> {
  if (catalog.region !== 'Москва') throw Error('Регион фида Ситилинка должен быть Москва');
  report.provider = 'citilink-yml';
  report.requests++;
  let payload: PartnerFeed;
  try {
    const {stdout} = await run('python3',['scripts/read-citilink-yml.py'],{
      env:{NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,CITILINK_MOSCOW_YML_URL:url},
      timeout:65_000,maxBuffer:10*1024*1024,
    });
    payload = JSON.parse(stdout);
  } catch {
    throw Error('Не удалось загрузить московский фид Ситилинка');
  }
  const checkedAt = Date.parse(payload.checkedAt);
  if (!Array.isArray(payload.rows) || !Number.isFinite(checkedAt) || checkedAt > Date.now()+60_000) throw Error('Ситилинк вернул неподтверждённый фид');
  const quotes = new Map(payload.rows.map(row=>[row.sku,row]));
  for (const product of catalog.products) {
    for (const old of product.offers) {
      if (old.store !== 'CITILINK' || !isAllowedStoreUrl(old.url,'CITILINK') || checkedAt <= Date.parse(old.checkedAt)) continue;
      const sku = new URL(old.url).pathname.match(/^\/product\/[a-z0-9_-]+-([a-z]?\d+)\/?$/i)?.[1].toLowerCase();
      const quote = sku && quotes.get(sku);
      if (!quote) continue;
      record(product,{store:'CITILINK',url:old.url,price:quote.price,checkedAt:payload.checkedAt,status:'ok',
        availability:quote.available?'in-stock':'unknown',transport:'api',identity:'verified-reference'});
    }
  }
  if (!report.updated) report.blocked = 'Фид Ситилинка не подтвердил новых цен по известным артикулам';
}
