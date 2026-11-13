import type {Offer,Product} from './catalog-types';
import {stores,type StoreId} from './stores.ts';
import {priceAgeHours} from './price-freshness.ts';
import {sourceIntervalHours,SOURCE_ALERT_HOURS} from './source-policy.ts';
import type {ProviderConfig,SourceKind} from './providers/types';
import {providers} from './providers/index.ts';

export type SourceStatus = {
  store:StoreId; source:SourceKind; region:'Москва'; currency:'RUB';
  offers:number; oldestPriceAt:string|null; oldestPriceAgeHours:number|null;
  newestPriceAt:string|null; lastSuccessfulAt:string|null;
  intervalHours:number; configured:boolean; overdue:boolean;
};
export function sourceKind(offer:Offer):SourceKind {
  return offer.source ?? (offer.transport==='feed'?'feed':offer.store==='DELECT'&&offer.transport==='api'?'api':'snapshot');
}
/** Merge by identity, retaining timestamps. A download or failed attempt is not price evidence. */
export function summarizeSources(products:Product[],patches:{productId:string;offer:Offer}[],config:ProviderConfig,
  successes:Partial<Record<StoreId,string>>={},now=Date.now()):SourceStatus[] {
  const rows = new Map<string,Offer>();
  for (const p of products) for (const o of p.offers) rows.set(p.id+':'+o.store,o);
  const known = new Set(products.map(p=>p.id));
  for (const {productId,offer} of patches) {
    if (!known.has(productId)) continue;
    const key = productId+':'+offer.store,old = rows.get(key);
    if (!old || Date.parse(offer.checkedAt)>Date.parse(old.checkedAt)) rows.set(key,offer);
  }
  const groups = new Map<StoreId,Offer[]>();
  for (const offer of rows.values()) {
    if (offer.status!=='ok'||typeof offer.price!=='number'||!Number.isFinite(offer.price)||offer.price<=0) continue;
    const group = groups.get(offer.store) ?? [];
    group.push(offer); groups.set(offer.store,group);
  }
  return stores.map(store=>{
    const offers = groups.get(store.id) ?? [];
    const dated = offers.map(o=>Date.parse(o.checkedAt)).filter(t=>Number.isFinite(t)&&t<=now);
    const oldestPriceAt = dated.length===offers.length && dated.length ? new Date(Math.min(...dated)).toISOString() : null;
    const newestPriceAt = dated.length ? new Date(Math.max(...dated)).toISOString() : null;
    const configured = providers.find(p=>p.store===store.id)?.isConfigured(config)??false;
    const latest = offers.reduce<Offer|undefined>((a,b)=>!a||Date.parse(b.checkedAt)>Date.parse(a.checkedAt)?b:a,undefined);
    return {store:store.id,source:latest?sourceKind(latest):store.id==='DNS'?'feed':store.id==='DELECT'?'api':'snapshot',
      region:'Москва',currency:'RUB',offers:offers.length,oldestPriceAt,
      oldestPriceAgeHours:oldestPriceAt?priceAgeHours({checkedAt:oldestPriceAt},now):null,newestPriceAt,
      lastSuccessfulAt:successes[store.id]??null,intervalHours:sourceIntervalHours(store.id,config),configured,
      overdue:!newestPriceAt||priceAgeHours({checkedAt:newestPriceAt},now)>SOURCE_ALERT_HOURS};
  });
}

export async function readSourceStatuses(db:D1Database,products:Product[],config:ProviderConfig,now=Date.now()) {
  const [offers,runs] = await Promise.all([
    db.prepare('SELECT product_id,data FROM price_offers WHERE is_seed=0').all<{product_id:string;data:string}>(),
    db.prepare("SELECT store,checked_at FROM source_health WHERE store GLOB 'PRICE_SOURCE_SUCCESS:*'")
      .all<{store:string;checked_at:string}>(),
  ]);
  return summarizeSources(products,offers.results.map(r=>({productId:r.product_id,offer:JSON.parse(r.data) as Offer})),
    config,Object.fromEntries(runs.results.map(r=>[r.store.slice('PRICE_SOURCE_SUCCESS:'.length),r.checked_at])),now);
}
