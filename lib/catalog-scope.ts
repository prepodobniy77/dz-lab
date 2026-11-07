import type {CatalogData,Product} from './catalog-types';

type MemoryItem = Pick<Product, 'category' | 'name'> & Partial<Pick<Product, 'description' | 'specs' | 'attributes'>>;

export function isSodimm(item: MemoryItem): boolean {
  if (item.category !== 'ram') return false;
  const identity = [item.specs?.moduleType, item.name, item.description, ...Object.values(item.attributes ?? {})].join(' ');
  return /\bSO[\s_\-‐‑‒–—−]*DIMM\b|(?:память|модуль)\s+для\s+ноутбук/iu.test(identity);
}

export function desktopCatalog(data: CatalogData): CatalogData {
  return {...data, products: data.products.filter(item => !isSodimm(item))};
}
