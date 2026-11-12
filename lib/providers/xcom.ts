import {matchesMpn,parseOffer,parseXcomCatalog} from '../providers.mts';
import type {Product} from '../catalog-types';
import {indexXcomProducts} from '../price-cycle-data.ts';
import {offerMetadata,type PriceProvider,type OfferBatch} from './types.ts';

const indexes=new WeakMap<Product[],ReturnType<typeof indexXcomProducts>>();
/** Snapshot adapter. It never requests a page without the caller's robots-aware reader. */
export const xcomProvider: PriceProvider = {
  store:'XCOM', source:'snapshot',
  async fetchOffers(context) {
    const target = context.snapshot;
    if (!target) throw new Error('Для XCOM нужна порция обхода с проверкой robots.txt.');
    const html = await target.read(target.url);
    if (html === undefined) return null;
    const exportedAt = new Date(context.now ?? Date.now()).toISOString();
    const batch: OfferBatch = {store:'XCOM',source:'snapshot',exportedAt,region:'Москва',currency:'RUB',offers:[]};
    if (html === null) return batch;
    if (/verify you are human|access denied|провер.{0,30}(?:человек|браузер)/i.test(html)) {
      throw new Error('HTTP 403: источник запросил проверку браузера');
    }
    if (target.category) {
      const match = indexes.get(context.products) ?? indexXcomProducts(context.products);
      indexes.set(context.products,match);
      batch.offers = parseXcomCatalog(html,target.category,exportedAt).flatMap(item => {
        const product = match(item);
        return product ? [{productId:product.id,offer:{...item.offers[0],...offerMetadata(batch),
          transport:'html-snapshot' as const,identity:'verified-reference' as const}}] : [];
      });
    } else if (target.product) {
      const product = target.product;
      if (product.mpn && !matchesMpn(html,product.mpn)) return batch;
      try {
        batch.offers = [{productId:product.id,offer:{...parseOffer(html,'XCOM',target.url,exportedAt),
          ...offerMetadata(batch),transport:'html-snapshot',identity:product.mpn?'mpn':'verified-reference'}}];
      } catch { /* A page without a valid main offer is not a new observation. */ }
    }
    return batch;
  },
};
