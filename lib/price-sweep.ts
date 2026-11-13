import {env} from 'cloudflare:workers';
import {getCatalog,database,offerWriteStatements,snapshot,snapshotById,snapshotIndexById} from './catalog-server';
import {readCatalogPriceDelta,mergeCatalogOffers} from './catalog-price-delta';
import type {Offer} from './catalog-types';
import type {StoreId} from './stores';
import {runPricePortion,type CycleState} from './price-cycle';
import {fetchHtml} from './providers.mts';
import {findRouterAIPriceLinks} from './routerai-price-search.mts';
import {findPriceLinks} from './ai-price-search.mts';
import {providers} from './providers/index.ts';
import {sourceIsDue} from './source-policy.ts';
import {saveSweepReport} from './price-report-store';
import {SweepIntervalError,priceSweepFailureMessage} from './price-job-errors';
import {categories} from './catalog';
import type {SweepReport} from './hourly-prices';
async function externalSweepProducts(db: D1Database, store?: StoreId) {
 const updates=new Map<string,Offer[]>();
 for(const {productId,offer} of await readCatalogPriceDelta(db,store)){
  if(!snapshotById.has(productId))continue;
  const existing=updates.get(productId);
  if(existing)existing.push(offer);else updates.set(productId,[offer]);
 }
 if(!updates.size)return snapshot.products;
 return snapshot.products.map(product=>updates.has(product.id)?mergeCatalogOffers(product,updates.get(product.id)!):product);
}
async function prepareXcomSweepProducts(db:D1Database,state:CycleState|undefined) {
 if(!state||state.phase==='scan')return externalSweepProducts(db,'XCOM');
 if(state.phase!=='details')return snapshot.products;
 const id=state.missing[state.index],position=snapshotIndexById.get(id);
 if(position===undefined)return snapshot.products;
 const row=await db.prepare('SELECT data FROM price_offers WHERE key=?').bind(id+':XCOM').first<{data:string}>();
 if(!row)return snapshot.products;
 const products=snapshot.products.slice();
 products[position]=mergeCatalogOffers(products[position],[JSON.parse(row.data) as Offer]);
 return products;
}
export async function runPriceSweep(trigger:SweepReport['trigger']='manual',bindings?:Cloudflare.Env){
 const db=database(bindings),config=(bindings??env) as unknown as Record<string,string|undefined>;
 const apis=providers.filter(p=>p.source==='api'&&p.isConfigured(config));
 const allStores=!!(config.ROUTERAI_API_KEY||config.PERPLEXITY_API_KEY||apis.length);
 const xcomOnly=!!bindings&&!allStores&&Number(config.PRICE_DETAIL_PORTION_REQUESTS)===1;
 const products=bindings?(xcomOnly?snapshot.products:await externalSweepProducts(db)):(await getCatalog()).products;
 return runPricePortion({db,products,config,read:fetchHtml,
  ...(bindings?{productIndices:snapshotIndexById}:{}),
  ...(xcomOnly?{prepareProducts:(state:CycleState|undefined)=>prepareXcomSweepProducts(db,state)}:{}),offerStatements:values=>offerWriteStatements(db,values),onReport:(report,final)=>saveSweepReport(db,report,final,config),
  ...(apis.length?{bulk:async()=>{
   const offers:{productId:string;offer:Offer}[]=[];
   for(const provider of apis){
    const last=await db.prepare('SELECT checked_at,error FROM source_health WHERE store=?').bind('PRICE_SOURCE_SUCCESS:'+provider.store).first<{checked_at:string;error:string}>();
    if(!sourceIsDue(provider.store,config,last?.error?(JSON.parse(last.error).startedAt??last.checked_at):last?.checked_at))continue;
    const batch=await provider.fetchOffers({products,config});if(batch)offers.push(...batch.offers);
   }
   return offers;
  }}:{}),
  ...(config.ROUTERAI_API_KEY?{search:(products,timeoutMs)=>findRouterAIPriceLinks(products,config.ROUTERAI_API_KEY!,config.ROUTERAI_MODEL,fetch,timeoutMs)}:config.PERPLEXITY_API_KEY?{search:(products,timeoutMs)=>findPriceLinks(products,config.PERPLEXITY_API_KEY!,config.PRICE_AI_MODEL,fetch,timeoutMs)}:{})
 },trigger);
}
export async function recordFailedSweep(error:unknown,trigger:SweepReport['trigger']='cron',bindings:Cloudflare.Env=env){
 const report:SweepReport={checkedAt:new Date().toISOString(),trigger,status:error instanceof SweepIntervalError?'blocked':'failed',attempted:0,updated:0,skipped:0,categories:Object.fromEntries(categories.map(c=>[c.id,{attempted:0,updated:0}])),message:error instanceof SweepIntervalError?error.message:priceSweepFailureMessage(error),...(error instanceof SweepIntervalError?{retryAfter:error.retryAfter}:{})};await saveSweepReport(database(bindings),report,true,bindings as unknown as Record<string,string|undefined>);return report;
}
