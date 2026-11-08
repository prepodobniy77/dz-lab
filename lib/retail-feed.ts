import {parse} from 'csv-parse/sync';
import {SaxesParser} from 'saxes';
import type {Offer, Product} from './catalog-types';
import {isAllowedStoreUrl, storeInfo, type StoreId} from './stores.ts';

export const MAX_FEED_BYTES = 10 * 1024 * 1024;
export const MAX_FEED_ROWS = 50_000;
export const FEED_PART_SIZE = 100;
const MAX_RETAIL_PRICE = 10_000_000;
export class FeedError extends Error {}
export class StaleFeedError extends FeedError {}

export function requireFreshFeed(checkedAt: string, maxAge: unknown, now = Date.now()) {
  const hours = maxAge === undefined || maxAge === '' ? 36 : Number(maxAge);
  if (!Number.isFinite(hours) || hours <= 0) throw new FeedError('FEED_MAX_AGE_HOURS должен быть больше нуля.');
  if (now - Date.parse(checkedAt) > hours * 3_600_000) {
    throw new StaleFeedError('Фид устарел: дата выгрузки старше допустимого срока.');
  }
}

export type FeedRow = {
  mpn: string;
  sku: string;
  url: string;
  price: number|null;
  availability: Offer['availability'];
};
export type RetailFeed = {checkedAt: string; rows: FeedRow[]};
type RawRow = Partial<Record<'mpn'|'sku'|'url'|'price'|'availability'|'currency', string>>;

export function feedDate(value: unknown, now = Date.now()): string {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim())
    : null;
  if (!match) throw new FeedError('В фиде нет даты выгрузки с временем и подходящего Last-Modified.');
  const [, date, time, seconds = '00', millis = '', zone = '+03:00'] = match;
  const wallTime = date + 'T' + time + ':' + seconds;
  const local = new Date(wallTime + 'Z');
  const observed = Date.parse(wallTime + millis + zone);
  if (!Number.isFinite(local.getTime()) || !local.toISOString().startsWith(wallTime) ||
      !Number.isFinite(observed) || observed > now + 300_000) {
    throw new FeedError('Дата выгрузки недействительна или находится в будущем.');
  }
  return new Date(observed).toISOString();
}

export async function readFeedBody(body: ReadableStream<Uint8Array> | null, length: string | null, limit = MAX_FEED_BYTES) {
  if (length !== null && Number(length) > limit) throw new FeedError('Превышен размер тела запроса.');
  if (!body) throw new FeedError('Тело запроса пустое.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new FeedError('Превышен размер тела запроса.');
      chunks.push(decoder.decode(value, {stream: true}));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof FeedError) throw error;
    throw new FeedError('Не удалось прочитать файл в UTF-8.');
  } finally {
    reader.releaseLock();
  }
}

function normalized(row: RawRow): FeedRow | null {
  const mpn = row.mpn?.trim() ?? '';
  const sku = row.sku?.trim() ?? '';
  const url = row.url?.trim() ?? '';
  const value = (row.price ?? '').trim().replace(',', '.');
  const price = /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value) : NaN;
  const currency = row.currency?.trim().toUpperCase();
  if ((!mpn && !sku && !url) || mpn.length > 256 || sku.length > 128 || url.length > 2048) return null;
  const validPrice = Number.isFinite(price) && price > 0 && price <= MAX_RETAIL_PRICE &&
    (!currency || currency === 'RUB' || currency === 'RUR');

  const stock = (row.availability ?? '').trim().toLowerCase();
  let availability: Offer['availability'];
  if (/^(true|1|yes|in[-_ ]stock|в наличии)$/.test(stock)) availability = 'in-stock';
  else if (/^(false|0|no|out[-_ ]of[-_ ]stock|нет в наличии)$/.test(stock)) availability = 'out-of-stock';
  else if (stock === '' || stock === 'unknown') availability = 'unknown';
  else return {mpn,sku,url,price:null,availability:'unknown'};
  return {mpn,sku,url,price:validPrice ? price : null,availability};
}

function parseXml(text: string): {date: string; rows: FeedRow[]} {
  const parser = new SaxesParser();
  const stack: string[] = [];
  const rows: FeedRow[] = [];
  const fields = {vendorCode:'mpn', mpn:'mpn', sku:'sku', shopSku:'sku', 'shop-sku':'sku', url:'url',
    price:'price', currencyId:'currency', currency:'currency', availability:'availability'} as const;
  let row: RawRow | undefined;
  let field: keyof RawRow | undefined;
  let value = '';
  let date = '';
  let count = 0;
  let offerPath = '';
  let offerDepth = 0;

  parser.on('doctype', type => {
    // YML exporters often emit this declaration. The parser does not load it.
    if (!/^yml_catalog\s+SYSTEM\s+["']shops\.dtd["']\s*$/.test(type.trim())) {
      throw new FeedError('В XML запрещены пользовательские DTD и сущности.');
    }
  });
  parser.on('opentag', tag => {
    stack.push(tag.name);
    if (stack.length > 32) throw new FeedError('Слишком большая вложенность XML.');
    if (stack.length === 1) {
      if (tag.name === 'yml_catalog') {
        offerPath = 'yml_catalog/shop/offers/offer';
        offerDepth = 4;
      } else if (tag.name === 'offers') {
        offerPath = 'offers/offer';
        offerDepth = 2;
      } else throw new FeedError('Ожидается корневой элемент yml_catalog или offers.');
      date = tag.attributes.date ?? tag.attributes.exported_at ?? '';
    }
    if (stack.length === offerDepth && stack.join('/') === offerPath) {
      if (++count > MAX_FEED_ROWS) throw new FeedError('Слишком много строк прайса.');
      row = {availability:tag.attributes.available,mpn:tag.attributes.mpn,sku:tag.attributes.sku ?? tag.attributes.id};
    } else if (row && stack.length === offerDepth + 1) {
      field = Object.hasOwn(fields, tag.name) ? fields[tag.name as keyof typeof fields] : undefined;
      value = '';
    } else if (field) {
      throw new FeedError('Поля предложения должны содержать текст.');
    }
  });
  const append = (part: string) => {
    if (!field) return;
    value += part;
    if (value.length > 4096) throw new FeedError('Слишком длинное поле предложения.');
  };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    if (row && stack.length === offerDepth + 1 && field) {
      row[field] = value;
      field = undefined;
    } else if (row && stack.length === offerDepth) {
      const valid = normalized(row);
      if (valid) rows.push(valid);
      row = undefined;
    }
    stack.pop();
  });
  parser.on('error', () => {throw new FeedError('Некорректный XML или неизвестная сущность.');});
  parser.write(text).close();
  if (!count) throw new FeedError('В XML отсутствуют предложения.');
  return {date, rows};
}

export function parseRetailFeed(text: string, headerDate?: string, now = Date.now(), lastModified?: string): RetailFeed {
  if (text.trimStart().startsWith('<')) {
    const xml = parseXml(text);
    const checkedAt = feedDate(xml.date || headerDate || lastModified, now);
    if (headerDate && feedDate(headerDate, now) !== checkedAt) throw new FeedError('Даты выгрузки расходятся.');
    return {checkedAt, rows: xml.rows};
  }

  // Detect a comma or semicolon outside a quoted header field.
  const header = text.split(/\r?\n/, 1)[0];
  const delimiter = header.replace(/"(?:[^"]|"")*"/g, '').includes(';') ? ';' : ',';
  let records: Record<string, string>[];
  try {
    records = parse(text, {bom:true, delimiter, columns: (names: string[]) => {
      const columns = names.map(name => name.trim().toLowerCase());
      if (new Set(columns).size !== columns.length || !columns.includes('price') ||
          !columns.some(column => ['mpn','sku','url','vendorcode'].includes(column))) {
        throw new FeedError('CSV должен содержать price и хотя бы одно из полей mpn, sku, url.');
      }
      return columns;
    }, skip_empty_lines:true, max_record_size:16_384, on_record: (record, context) => {
      if (context.records > MAX_FEED_ROWS) throw new FeedError('Слишком много строк прайса.');
      return record;
    }});
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError('Некорректный CSV.');
  }

  if (!records.length || records.length > MAX_FEED_ROWS) throw new FeedError('В CSV нет допустимого числа строк.');
  const feedRecord = records.find(record => record.date?.trim() || record.checkedat?.trim());
  const checkedAt = feedDate(headerDate || feedRecord?.date?.trim() || feedRecord?.checkedat?.trim() || lastModified, now);
  const rows: FeedRow[] = [];
  for (const record of records) {
    const rowDate = record.date || record.checkedat;
    if (rowDate && feedDate(rowDate, now) !== checkedAt) throw new FeedError('Строки CSV относятся к разным выгрузкам.');
    const row = normalized({...record, mpn:record.mpn ?? record.vendorcode,
      availability:record.availability ?? record.available, currency:record.currency ?? record.currencyid});
    if (row) rows.push(row);
  }
  return {checkedAt, rows};
}

type KnownOffer = {product: Product; offer: Offer};
type IdentityIndex = Map<string, KnownOffer | null>;
const key = (value: string) => value.trim().toUpperCase();
const productSku = (url: URL, store: StoreId) => store === 'DNS'
  ? url.pathname.match(/^\/product\/([a-f\d]{16})\//i)?.[1].toUpperCase()
  : undefined;
const reference = (url: URL) => url.origin + url.pathname.replace(/\/$/, '');
export function feedStore(value: unknown): StoreId {
  if (typeof value !== 'string') throw new FeedError('Укажи магазин.');
  const store = storeInfo(value.toUpperCase());
  if (!store || store.id === 'DELECT') throw new FeedError('Этот розничный магазин не поддерживается.');
  return store.id;
}

export function indexFeedCatalog(products: Product[], store: StoreId) {
  const mpn: IdentityIndex = new Map();
  const catalogMpn = new Map<string,Product|null>();
  const sku: IdentityIndex = new Map();
  const url: IdentityIndex = new Map();
  let expected = 0;
  const add = (index: IdentityIndex, id: string | undefined, entry: KnownOffer) => {
    if (id) index.set(id, index.has(id) && index.get(id)?.product.id !== entry.product.id ? null : entry);
  };
  for (const product of products) {
    const part = key(product.mpn);
    if (part) catalogMpn.set(part,catalogMpn.has(part) ? null : product);
    const offer = product.offers.find(candidate => candidate.store === store);
    if (!offer || !isAllowedStoreUrl(offer.url, store)) continue;
    expected++;
    const link = new URL(offer.url);
    const entry = {product, offer};
    add(mpn, key(product.mpn), entry);
    add(sku, productSku(link, store), entry);
    add(sku, offer.sku ? key(offer.sku) : undefined, entry);
    add(url, reference(link), entry);
  }

  return {
    expected,
    match(row: FeedRow, {bootstrap = false, includeInvalid = false} = {}) {
      if (typeof row?.mpn !== 'string' || row.mpn.length > 256 || typeof row.sku !== 'string' || row.sku.length > 128 ||
          typeof row.url !== 'string' || row.url.length > 2048 ||
          !['in-stock','out-of-stock','unknown'].includes(row.availability)) return null;
      const validPrice = typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 && row.price <= MAX_RETAIL_PRICE;
      if (!includeInvalid && !validPrice) return null;
      if (row.url && !isAllowedStoreUrl(row.url, store)) return null;
      const link = row.url ? new URL(row.url) : undefined;
      const urlSku = link ? productSku(link, store) : undefined;
      const skuMatch = row.sku ? sku.get(key(row.sku)) : undefined;
      const urlMatch = link ? (url.get(reference(link)) ?? (urlSku ? sku.get(urlSku) : undefined)) : undefined;
      const mpnMatch = row.mpn ? mpn.get(key(row.mpn)) : undefined;
      const matched = urlMatch ?? skuMatch ?? mpnMatch;
      if (!matched) {
        const product = bootstrap && link && catalogMpn.get(key(row.mpn));
        if (!product || [urlMatch,skuMatch,mpnMatch].includes(null)) return null;
        if (store === 'DNS' && (!urlSku || (/^[a-f\d]{16}$/i.test(row.sku) && key(row.sku) !== urlSku))) return null;
        return {product,offer:{store,url:row.url,sku:row.sku || undefined,price:null,
          checkedAt:'',availability:'unknown',status:'error'} satisfies Offer,validPrice};
      }
      if ([urlMatch,skuMatch,mpnMatch].some(candidate => candidate && candidate.product.id !== matched.product.id)) return null;
      if (link && reference(link) !== reference(new URL(matched.offer.url)) &&
          (!urlSku || urlSku !== productSku(new URL(matched.offer.url), store))) return null;
      if (row.mpn && matched.product.mpn && key(row.mpn) !== key(matched.product.mpn)) return null;
      if (row.sku && /^[a-f\d]{16}$/i.test(row.sku) && store === 'DNS' &&
          key(row.sku) !== productSku(new URL(matched.offer.url), store)) return null;
      if (row.sku && matched.offer.sku && key(row.sku) !== key(matched.offer.sku) && !skuMatch) return null;
      return {...matched,validPrice};
    },
  };
}
