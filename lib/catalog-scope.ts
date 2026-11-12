import type {CatalogData,Product} from './catalog-types';

type MemoryItem = Pick<Product, 'category' | 'name'> & Partial<Pick<Product, 'description' | 'specs' | 'attributes'>>;

export function isSodimm(item: MemoryItem): boolean {
  if (item.category !== 'ram') return false;
  const identity = [item.specs?.moduleType, item.name, item.description, ...Object.values(item.attributes ?? {})].join(' ');
  return /\bSO[\s_\-‐‑‒–—−]*DIMM\b|(?:память|модуль)\s+для\s+ноутбук/iu.test(identity);
}

export function desktopCatalog(data: CatalogData): CatalogData {
  const products = data.products.filter(item => !isSodimm(item));
  const hasDnsPrices = products.some(product => product.offers.some(offer =>
    offer.store === 'DNS' && offer.status === 'ok' && typeof offer.price === 'number' &&
    Number.isFinite(offer.price) && offer.price > 0));
  const sources = hasDnsPrices ? data.sources : data.sources.filter(source => source.name !== 'DNS');
  return {...data, products, sources};
}
