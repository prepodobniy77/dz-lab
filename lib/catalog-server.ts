import {parseSweepReport,publicSweepReport} from './price-status';
import {offerWriteStatements} from './offer-storage';
export {offerWriteStatements} from './offer-storage';
import {env} from 'cloudflare:workers';
import raw from '../data/catalog.json';
import type {CatalogData,Product,Offer} from './catalog-types';
import {desktopCatalog} from './catalog-scope';
export const snapshot=desktopCatalog(raw as unknown as CatalogData);
export function database(){if(!env.DB)throw new Error('База данных недоступна');return env.DB}
export async function getCatalog(){
 const products:Product[]=snapshot.products.map(p=>({...p,offers:p.offers.map(o=>({...o}))}));
 const rows=await database().prepare('SELECT product_id,store,data FROM price_offers LIMIT 10000').all<{product_id:string;store:string;data:string}>();
 for(const row of rows.results){const p=products.find(p=>p.id===row.product_id);if(p){const offer=JSON.parse(row.data) as Offer;const index=p.offers.findIndex(o=>o.store===row.store);if(index>=0){if(Date.parse(offer.checkedAt)>=Date.parse(p.offers[index].checkedAt))p.offers[index]=offer}else p.offers.push(offer)}}
 const health=await database().prepare("SELECT store,checked_at,blocked_until,error FROM source_health WHERE store IN ("+[...snapshot.sources.map(s=>s.name),'PRICE_SWEEP','PRICE_SWEEP_SUCCESS'].map(()=>'?').join(',')+") OR store LIKE 'PRICE_REVIEW:%'").bind(...snapshot.sources.map(s=>s.name),'PRICE_SWEEP','PRICE_SWEEP_SUCCESS').all<{store:string;checked_at:string;blocked_until:string|null;error:string|null}>();
 const reviews=new Set(health.results.filter(h=>h.store.startsWith('PRICE_REVIEW:')).map(h=>h.store));for(const p of products){p.priceReviewPending=[...reviews].some(key=>key.startsWith('PRICE_REVIEW:'+p.id+':'));for(const offer of p.offers)offer.requiresReview=reviews.has('PRICE_REVIEW:'+p.id+':'+offer.store)}
 const sources=snapshot.sources.map(source=>{const offers=products.flatMap(p=>p.offers.filter(o=>o.store===source.name));const priced=offers.filter(o=>o.status==='ok'&&o.price!==null);const status=priced.length?(source.status==='partial'||priced.length<offers.length?'partial':'ok'):offers.length?'limited':source.status;const sourceHealth=health.results.find(h=>h.store===source.name);const limited=sourceHealth?.blocked_until&&Date.parse(sourceHealth.blocked_until)>Date.now();return{...source,status:limited?'limited':status,...(sourceHealth?{checkedAt:sourceHealth.checked_at}:{}),...(limited?{note:'Серверные запросы приостановлены до '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(sourceHealth.blocked_until!))+' МСК. '+sourceHealth.error}:{} )}});
 const config=env as unknown as Record<string,unknown>;return {...snapshot,products,sources,priceUpdate:publicSweepReport(parseSweepReport(health.results.find(h=>h.store==='PRICE_SWEEP')?.error),parseSweepReport(health.results.find(h=>h.store==='PRICE_SWEEP_SUCCESS')?.error)),priceApi:{configured:!!(config.ROUTERAI_API_KEY||config.PERPLEXITY_API_KEY||config.DELECT_API_KEY&&config.DELECT_DISTRIBUTOR),provider:config.ROUTERAI_API_KEY?'RouterAI':config.PERPLEXITY_API_KEY?'Perplexity Agent API':'Delect API Lite'},storage:'connected'};
}
export async function persistOffers(offers:{productId:string;offer:Offer}[]){if(offers.length)await database().batch(offerWriteStatements(database(),offers))}
export async function persistOffer(productId:string,offer:Offer){await persistOffers([{productId,offer}])}
