import {env} from 'cloudflare:workers';
import {getCatalog,database,offerWriteStatements,snapshot,snapshotById} from './catalog-server';
import {readCatalogPriceDelta,mergeCatalogOffers} from './catalog-price-delta';
import type {Offer} from './catalog-types';
import {runPricePortion} from './price-cycle';
import {fetchHtml} from './providers.mts';
import {findRouterAIPriceLinks} from './routerai-price-search.mts';
import {findPriceLinks} from './ai-price-search.mts';
import {fetchPriceExport,apiOffers} from './price-api.mts';
import {saveSweepReport} from './price-report-store';
import {SweepIntervalError,priceSweepFailureMessage} from './price-job-errors';
import {categories} from './catalog';
import type {SweepReport} from './hourly-prices';
async function externalSweepProducts(db: D1Database) {
 const updates=new Map<string,Offer[]>();
 for(const {productId,offer} of await readCatalogPriceDelta(db)){
  if(!snapshotById.has(productId))continue;
  const existing=updates.get(productId);
  if(existing)existing.push(offer);else updates.set(productId,[offer]);
 }
 if(!updates.size)return snapshot.products;
 return snapshot.products.map(product=>updates.has(product.id)?mergeCatalogOffers(product,updates.get(product.id)!):product);
}
export async function runPriceSweep(trigger:SweepReport['trigger']='manual',bindings?:Cloudflare.Env){
 const db=database(bindings),config=(bindings??env) as unknown as Record<string,string|undefined>;
 const products=bindings?await externalSweepProducts(db):(await getCatalog()).products;
 return runPricePortion({db,products,config,read:fetchHtml,offerStatements:values=>offerWriteStatements(db,values),onReport:(report,final)=>saveSweepReport(db,report,final,config),
  ...(config.DELECT_API_KEY&&config.DELECT_DISTRIBUTOR?{bulk:async()=>apiOffers(products,await fetchPriceExport(config.DELECT_API_KEY!,config.DELECT_DISTRIBUTOR!),config.DELECT_DISTRIBUTOR!).map(v=>({productId:v.id,offer:v.offer}))}:{}),
  ...(config.ROUTERAI_API_KEY?{search:(products,timeoutMs)=>findRouterAIPriceLinks(products,config.ROUTERAI_API_KEY!,config.ROUTERAI_MODEL,fetch,timeoutMs)}:config.PERPLEXITY_API_KEY?{search:(products,timeoutMs)=>findPriceLinks(products,config.PERPLEXITY_API_KEY!,config.PRICE_AI_MODEL,fetch,timeoutMs)}:{})
 },trigger);
}
export async function recordFailedSweep(error:unknown,trigger:SweepReport['trigger']='cron',bindings:Cloudflare.Env=env){
 const report:SweepReport={checkedAt:new Date().toISOString(),trigger,status:error instanceof SweepIntervalError?'blocked':'failed',attempted:0,updated:0,skipped:0,categories:Object.fromEntries(categories.map(c=>[c.id,{attempted:0,updated:0}])),message:error instanceof SweepIntervalError?error.message:priceSweepFailureMessage(error),...(error instanceof SweepIntervalError?{retryAfter:error.retryAfter}:{})};await saveSweepReport(database(bindings),report,true,bindings as unknown as Record<string,string|undefined>);return report;
}
