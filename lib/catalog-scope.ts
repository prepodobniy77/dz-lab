import type {CatalogData,Product} from './catalog-types';
import {storeInfo} from './stores.ts';

type MemoryItem = Pick<Product, 'category' | 'name'> & Partial<Pick<Product, 'description' | 'specs' | 'attributes'>>;

export function isSodimm(item: MemoryItem): boolean {
  if (item.category !== 'ram') return false;
  const identity = [item.specs?.moduleType, item.name, item.description, ...Object.values(item.attributes ?? {})].join(' ');
  return /\bSO[\s_\-‐‑‒–—−]*DIMM\b|(?:память|модуль)\s+для\s+ноутбук/iu.test(identity);
}

export function desktopCatalog(data: CatalogData): CatalogData {
  const products = data.products.filter(item => !isSodimm(item)).map(product=>{
    const offers=product.offers.filter(offer=>storeInfo(offer.store));
    return offers.length===product.offers.length?product:{...product,offers};
  });
  const hasDnsPrices = products.some(product => product.offers.some(offer =>
    offer.store === 'DNS' && offer.status === 'ok' && typeof offer.price === 'number' &&
    Number.isFinite(offer.price) && offer.price > 0));
  const sources = data.sources.filter(source=>storeInfo(source.name)&&(hasDnsPrices||source.name!=='DNS'));
  for(const id of ['BIT28','MVIDEO'])if(!sources.some(source=>source.name===id))sources.push({name:id,url:storeInfo(id)!.url,status:'pending',note:'Цены ещё не подключены. Ожидается подтверждённый источник розничных цен по Москве.'});
  return {...data, products, sources};
}
