import type {CatalogData, Offer} from './catalog-types';
import type {PublicSweepReport} from './price-status';
import {isAllowedStoreUrl, storeInfo, type StoreId} from './stores.ts';

export type PriceObservation = {productId: string; offer: Offer};
export type StoreRefresh = {
  store: StoreId;
  requests: number;
  updated: number;
  failures: number;
  review: number;
  blocked?: string;
  finished?: boolean;
  provider?: 'reefapi'|'anysite'|'citilink-yml'|'public-browser';
  cursor?: number;
  listingPages?: Record<string, number>;
};
export type PriceFeed = {
  version: 1;
  region: 'Москва';
  report: PublicSweepReport;
  stores: StoreRefresh[];
  observations: PriceObservation[];
};

export function parsePriceFeed(value: unknown, now = Date.now()): PriceFeed | null {
  if (!value || typeof value !== 'object') return null;
  const feed = value as PriceFeed;
  const report = feed.report;
  if (feed.version !== 1 || feed.region !== 'Москва' || !Array.isArray(feed.observations) ||
      feed.observations.length > 50_000 || !Array.isArray(feed.stores) || feed.stores.length > 20 ||
      !report || !['complete','partial','blocked','failed'].includes(report.status)) return null;
  const checkedAt = Date.parse(report.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 300_000 ||
      !Number.isSafeInteger(report.updated) || report.updated < 0 ||
      !Number.isSafeInteger(report.attempted) || report.attempted < 0) return null;
  if (report.lastSuccessfulAt !== null) {
    const lastSuccess = Date.parse(report.lastSuccessfulAt);
    if (!Number.isFinite(lastSuccess) || lastSuccess > checkedAt) return null;
  }
  return feed;
}

function validOffer(offer: Offer, reportTime: number): boolean {
  const checkedAt = Date.parse(offer.checkedAt);
  return Boolean(storeInfo(offer.store)) && typeof offer.url === 'string' &&
    isAllowedStoreUrl(offer.url, offer.store) && offer.status === 'ok' &&
    typeof offer.price === 'number' && Number.isFinite(offer.price) && offer.price > 0 && offer.price <= 10_000_000 &&
    Number.isFinite(checkedAt) && checkedAt <= reportTime &&
    ['in-stock','out-of-stock','unknown'].includes(offer.availability);
}

export function knownPriceObservations(catalog: CatalogData, feed: PriceFeed): PriceObservation[] {
  if (catalog.region !== feed.region) return [];
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const latest = new Map<string, PriceObservation>();
  const reportTime = Date.parse(feed.report.checkedAt);
  for (const row of feed.observations) {
    if (!row || typeof row.productId !== 'string' || !row.offer || !validOffer(row.offer, reportTime)) continue;
    const {offer, productId} = row;
    const base = products.get(productId)?.offers.find(item => item.store === offer.store && item.url === offer.url);
    if (!base || Date.parse(offer.checkedAt) <= Date.parse(base.checkedAt)) continue;
    const key = productId + ':' + offer.store;
    const previous = latest.get(key);
    if (!previous || Date.parse(previous.offer.checkedAt) < Date.parse(offer.checkedAt)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function applyPriceFeed<T extends CatalogData>(catalog: T, feed: PriceFeed): T {
  if (catalog.region !== feed.region) return catalog;
  const updated = new Map<string, Offer>();
  const observedAt = new Map<StoreId, string>();
  for (const {productId, offer} of knownPriceObservations(catalog, feed)) {
    updated.set(productId + ':' + offer.store, offer);
    if (Date.parse(offer.checkedAt) > Date.parse(observedAt.get(offer.store) ?? '1970-01-01')) {
      observedAt.set(offer.store, offer.checkedAt);
    }
  }
  const sources = catalog.sources.map(source => {
    const run = feed.stores.find(item => item?.store === source.name);
    if (!run) return source;
    const checkedAt = observedAt.get(run.store);
    return {
      ...source,
      ...(checkedAt && Date.parse(checkedAt) > Date.parse(source.checkedAt ?? '1970-01-01') ? {checkedAt} : {}),
      ...(run.updated > 0 ? {status: 'partial'} : run.blocked ? {status: 'limited'} : {}),
      note: run.updated > 0
        ? 'Цены обновлены для ' + run.updated + ' предложений. ' + (run.blocked ? 'Доступ к остальным позициям ограничен.' : '')
        : run.blocked ? 'Магазин ограничил доступ или не ответил. Сохранены последние цены.' : source.note,
    };
  });
  const products = catalog.products.map(product => {
    if (!product.offers.some(offer => updated.has(product.id + ':' + offer.store))) return product;
    return {
      ...product,
      offers: product.offers.map(offer => {
        const current = updated.get(product.id + ':' + offer.store);
        if (!current) return offer;
        const {error, requiresReview, ...base} = offer;
        return {...base, price: current.price, checkedAt: current.checkedAt, status: current.status,
          availability: current.availability, transport: current.transport === 'api' ? 'api' as const : 'html-snapshot' as const};
      }),
    };
  });
  return {...catalog, products, sources, priceUpdate: feed.report};
}
