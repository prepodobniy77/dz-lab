import type {Product,Offer} from './catalog-types';
import type {SweepReport} from './hourly-prices.ts';
import {oldestPriceSelection} from './hourly-prices.ts';
import {parseXcomCatalog,parseOffer,matchesMpn} from './providers.mts';
import {xcomJobs,indexXcomProducts,stagePrice,coverageAccepted,type StagedPrice} from './price-cycle-data.ts';
import {robotsPolicy} from './robots-policy.ts';
import {hasFreshPrice} from './price-freshness.ts';
import {aiProductLimit,minSweepIntervalMinutes} from './price-update-policy.ts';
import {SweepIntervalError,priceSweepFailureMessage} from './price-job-errors.ts';
import {categories} from './catalog.ts';
import type {PriceLink} from './ai-price-search.mts';
export type CycleState={id:string;startedAt:string;phase:'scan'|'details'|'publish'|'ai'|'done';index:number;publishOffset:number;expected:number;staged:Record<string,StagedPrice>;seen:string[];missing:string[];robots?:{text:string;at:number};lastRequestAt:number;hostRules?:Record<string,{text:string;at:number;lastAt:number}>;aiAttempted:string[];aiVisited:string[];bulkDone:boolean;updatedIds:string[];attemptedIds:string[];pendingReviews:number;portions:number;activeDurationMs:number;report:SweepReport};
export type CycleResult={done:boolean;cursor:{cycleId:string;phase:string;category?:string;page?:number;index:number}|null;processed:number;skipped?:boolean;reason?:string;report:SweepReport};
export type CycleServices={db:D1Database;products:Product[];config:Record<string,string|undefined>;read:(url:string,timeoutMs:number)=>Promise<string>;bulk?:()=>Promise<{productId:string;offer:Offer}[]>;search?:(products:Product[],timeoutMs:number)=>Promise<PriceLink[]>;offerStatements:(values:{productId:string;offer:Offer}[])=>D1PreparedStatement[];now?:()=>number;pause?:(ms:number)=>Promise<void>;onReport:(report:SweepReport,final:boolean)=>Promise<void>};
const jobs=xcomJobs();
const STATE='PRICE_CYCLE_STATE',LEASE='PRICE_CYCLE_LEASE',SUCCESS='PRICE_SWEEP_SUCCESS';
export async function runPricePortion(services:CycleServices,trigger:SweepReport['trigger']='manual'):Promise<CycleResult>{
 const {db,products,config}=services,now=services.now||Date.now,pause=services.pause||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));const start=now(),deadline=start+115000;let dbRequests=0,httpRequests=0;
 const row=async(key:string)=>{dbRequests++;return db.prepare('SELECT error,blocked_until FROM source_health WHERE store=?').bind(key).first<{error:string|null;blocked_until:string|null}>()};
 const leaseToken=crypto.randomUUID();dbRequests++;const acquired=await db.batch([db.prepare("INSERT INTO source_health(store,checked_at,blocked_until,error) VALUES(?,?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,blocked_until=excluded.blocked_until,error=excluded.error WHERE source_health.blocked_until IS NULL OR source_health.blocked_until<=excluded.checked_at").bind(LEASE,new Date(start).toISOString(),new Date(start+3*60000).toISOString(),leaseToken)]);
 if(!acquired[0].meta.changes){const busy=await row(LEASE);throw new SweepIntervalError(Math.max(1,(Date.parse(busy?.blocked_until||'')-start)/1000)||180,'active_portion')}
 let state:CycleState|undefined;let processed=0;const currentCursor=()=>{if(!state||state.phase==='done')return null;const job=jobs[state.index];return{cycleId:state.id,phase:state.phase,index:state.index,...(state.phase==='scan'&&job?{category:job.category,page:job.page}:{})}};
 const stateStatement=()=>{const text=JSON.stringify(state);if(new TextEncoder().encode(text).length>1800000)throw new Error('Данные цикла превышают безопасный размер');return db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES(?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(STATE,new Date(now()).toISOString(),text)};
 const saveState=async(extra:D1PreparedStatement[]=[])=>{dbRequests++;await db.batch([...extra,stateStatement()])};
 const markAttempt=(id:string)=>{if(!state!.attemptedIds.includes(id))state!.attemptedIds.push(id)};
 const add=(product:Product,offer:Offer)=>{const staged=stagePrice(product,offer);if(staged){state!.staged[product.id+':'+offer.store]=staged;if(offer.store==='XCOM'&&!state!.seen.includes(product.id))state!.seen.push(product.id)}markAttempt(product.id)};
 const finalise=async(status:SweepReport['status'],message:string)=>{state!.phase='done';state!.report.status=status;state!.report.message=message;state!.report.finishedAt=new Date(now()).toISOString()};
 const read=async(url:string)=>{if(!state!.robots||now()-state!.robots.at>15*60000){const delay=Math.max(0,state!.lastRequestAt+500-now());if(now()+delay+1000>=deadline)throw new Error('Недостаточно времени для запроса');if(delay)await pause(delay);httpRequests++;let text:string;try{text=await services.read('https://www.xcom-shop.ru/robots.txt',Math.min(18000,deadline-now()-500))}catch(error){if(/HTTP 404/.test(String(error)))text='';else if(/HTTP (401|403|429)/.test(String(error)))throw error;else throw new Error('Не удалось прочитать правила источника')}state!.lastRequestAt=now();if(/<html|<!doctype/i.test(text)||text.length>500000)throw new Error('Не удалось прочитать правила источника');state!.robots={text,at:now()}}
  if(httpRequests>=18)return undefined;const rules=robotsPolicy(state!.robots.text);if(!rules.allows(url))return null;const delay=Math.max(0,state!.lastRequestAt+rules.delayMs-now());if(now()+delay+1000>=deadline)return undefined;if(delay)await pause(delay);httpRequests++;try{return await services.read(url,Math.min(18000,deadline-now()-500))}finally{state!.lastRequestAt=now()}};
 const readOther=async(url:string)=>{const origin=new URL(url).origin;state!.hostRules||={};let host=state!.hostRules[origin];if(!host||now()-host.at>15*60000){if(httpRequests>=17)return undefined;httpRequests++;let text:string;try{text=await services.read(origin+'/robots.txt',Math.min(18000,deadline-now()-500))}catch(error){if(/HTTP 404/.test(String(error)))text='';else return undefined}if(/<html|<!doctype/i.test(text))return undefined;host={text,at:now(),lastAt:now()};state!.hostRules[origin]=host}if(!robotsPolicy(host.text).allows(url)||httpRequests>=18)return undefined;const delay=Math.max(0,host.lastAt+robotsPolicy(host.text).delayMs-now());if(now()+delay+1000>=deadline)return undefined;if(delay)await pause(delay);httpRequests++;try{return await services.read(url,Math.min(18000,deadline-now()-500))}finally{host.lastAt=now()}};
 try{
  const existing=await row(STATE);if(existing?.error)state=JSON.parse(existing.error) as CycleState;
  if(state?.phase==='done'&&state.report.done&&!await row('PRICE_SWEEP_RUN:'+state.id)){
   await services.onReport(state.report,true);
   return{done:true,cursor:null,processed:0,report:state.report};
  }
  if(!state||state.phase==='done'){
   const success=await row(SUCCESS);const last=success?.error?JSON.parse(success.error) as SweepReport:null;const lastSuccessTime=Date.parse(last?.finishedAt||last?.checkedAt||'');const completedTime=state?.report.cycleCompleted?Date.parse(state.report.finishedAt||''):NaN;const lastTime=Number.isFinite(completedTime)?Math.max(completedTime,Number.isFinite(lastSuccessTime)?lastSuccessTime:0):lastSuccessTime;
   if(Number.isFinite(lastSuccessTime)&&start-lastSuccessTime<6*3600000)return{done:true,cursor:null,processed:0,skipped:true,reason:'recent_success',report:last!};
   const elapsed=start-lastTime,interval=minSweepIntervalMinutes(config.MIN_SWEEP_INTERVAL_MINUTES)*60000;if(Number.isFinite(lastTime)&&elapsed<interval)throw new SweepIntervalError((interval-elapsed)/1000);
   const legacy=await row('PRICE_SWEEP_LOCK');if(legacy?.blocked_until&&Date.parse(legacy.blocked_until)>start)throw new SweepIntervalError((Date.parse(legacy.blocked_until)-start)/1000);
   const block=await row('XCOM');if(block?.blocked_until&&Date.parse(block.blocked_until)>start)throw new SweepIntervalError((Date.parse(block.blocked_until)-start)/1000);
   const visited=await row('PRICE_SWEEP_SELECTION');let aiVisited:string[]=[];try{aiVisited=visited?.error?JSON.parse(visited.error).attemptedIds:[]}catch{};if(!Array.isArray(aiVisited))aiVisited=[];
   state={id:crypto.randomUUID(),startedAt:new Date(start).toISOString(),phase:'scan',index:0,publishOffset:0,expected:products.filter(p=>p.offers.some(o=>o.store==='XCOM')).length,staged:{},seen:[],missing:[],lastRequestAt:0,aiAttempted:[],aiVisited,bulkDone:false,updatedIds:[],attemptedIds:[],pendingReviews:0,portions:0,activeDurationMs:0,report:{checkedAt:new Date(start).toISOString(),cycleId:'',status:'partial',trigger,attempted:0,updated:0,skipped:0,categories:Object.fromEntries(categories.map(c=>[c.id,{attempted:0,updated:0}])),message:'Идёт проверка; данные ещё не опубликованы.'}};state.report.cycleId=state.id;await saveState();
  }
  state.report.updatedOffers??=state.updatedIds.length;
  if(!state.bulkDone){state.bulkDone=true;await saveState();if(services.bulk){httpRequests++;for(const v of await services.bulk()){const p=products.find(p=>p.id===v.productId);if(p&&hasFreshPrice([v.offer],now()))add(p,v.offer)}}}
  let requests=0;
  let matchListing: ReturnType<typeof indexXcomProducts> | undefined;
  let productsById: Map<string,Product> | undefined;
  const requestLimit=Math.min(15,Math.max(1,Number(config.PRICE_PORTION_REQUESTS)||15));
  const detailLimit=Math.min(requestLimit,Math.max(1,Number(config.PRICE_DETAIL_PORTION_REQUESTS)||requestLimit));
  while((state.phase==='scan'||state.phase==='details')&&requests<(state.phase==='details'?detailLimit:requestLimit)&&now()+1500<deadline){
   if(state.phase==='scan'&&state.index>=jobs.length){state.phase='details';state.index=0;state.missing=products.filter(p=>p.offers.some(o=>o.store==='XCOM')&&!state!.seen.includes(p.id)).map(p=>p.id);continue}
   if(state.phase==='details'&&state.index>=state.missing.length){if(!coverageAccepted(state.seen.length,state.expected)){await finalise('failed',`Охват XCOM ${state.seen.length} из ${state.expected}, ниже 80%. Предложения не опубликованы.`)}else{state.phase='publish';state.index=0}break}
   const job=jobs[state.index],product=state.phase==='details'?(productsById??=new Map(products.map(p=>[p.id,p]))).get(state.missing[state.index]):undefined;const url=state.phase==='scan'?job.url:product?.offers.find(o=>o.store==='XCOM')?.url;
   if(!url){state.index++;continue}let html:string|null|undefined;
   try{html=await read(url);requests++}catch(error){if(/HTTP (401|403|429)/.test(String(error))){dbRequests++;await db.batch([db.prepare("INSERT INTO source_health(store,checked_at,blocked_until,error) VALUES('XCOM',?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,blocked_until=excluded.blocked_until,error=excluded.error").bind(new Date(now()).toISOString(),new Date(now()+6*3600000).toISOString(),'Источник ограничил серверный доступ')]);await finalise('partial','Источник ограничил доступ. Обход остановлен; старые цены сохранены.');break}if(/правила источника/.test(String(error))){await finalise('blocked','Не удалось проверить robots.txt. Обход не запускался.');break}state.index++;continue}
   if(html===undefined)break;
   if(html!==null){if(state.phase==='scan'){const parsed=parseXcomCatalog(html,job.category as Product['category'],new Date(now()).toISOString());if(!parsed.length&&/verify you are human|access denied|провер.{0,30}(?:человек|браузер)/i.test(html)){await finalise('partial','Источник запросил проверку браузера. Обход остановлен.');break}for(const item of parsed){const known=(matchListing??=indexXcomProducts(products))(item);if(known)add(known,{...item.offers[0],transport:'html-snapshot',identity:'verified-reference'})}}
    else if(product){markAttempt(product.id);try{if(product.mpn&&!matchesMpn(html,product.mpn))throw new Error('Артикул не подтверждён');add(product,{...parseOffer(html,'XCOM',url,new Date(now()).toISOString()),transport:'html-snapshot',identity:product.mpn?'mpn':'verified-reference'})}catch{}}
   }
   state.index++;processed++;
  }
  let publication:D1PreparedStatement[]|undefined;
  if(state.phase==='publish'&&now()+30000<deadline){
   const entries=Object.values(state.staged),batchSize=Math.min(500,Math.max(1,Number(config.PRICE_PUBLISH_PORTION_SIZE)||500));const chunk=entries.slice(state.publishOffset,state.publishOffset+batchSize);const published=chunk.filter(v=>!v.review),review=chunk.filter(v=>v.review);state.publishOffset+=chunk.length;
   for(const v of published)if(!state.updatedIds.includes(v.productId))state.updatedIds.push(v.productId);state.pendingReviews+=review.length;
   const writes=services.offerStatements(published);for(const v of published)writes.push(db.prepare('DELETE FROM source_health WHERE store=?').bind('PRICE_REVIEW:'+v.productId+':'+v.offer.store));for(const v of review)writes.push(db.prepare('INSERT INTO source_health(store,checked_at,error) VALUES(?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error').bind('PRICE_REVIEW:'+v.productId+':'+v.offer.store,v.offer.checkedAt,JSON.stringify(v)));
   state.report.updatedOffers+=published.length;
   publication=writes;processed+=chunk.length;if(state.publishOffset>=entries.length)state.phase='ai';
  }
  if(state.phase==='ai'&&!publication){
   const freshStaged=new Set(Object.values(state.staged).filter(v=>!v.review&&hasFreshPrice([v.offer],now())).map(v=>v.productId));
   const candidates=services.search?products.filter(p=>!freshStaged.has(p.id)&&!hasFreshPrice(p.offers,now())):[];if(candidates.every(p=>state!.aiVisited.includes(p.id)))state.aiVisited=[];
   const remaining=aiProductLimit(config.AI_MAX_PRODUCTS_PER_RUN)-state.aiAttempted.length;const selected=oldestPriceSelection(candidates,aiProductLimit(config.AI_MAX_PRODUCTS_PER_RUN),state.aiVisited).filter(p=>!state!.aiAttempted.includes(p.id)).slice(0,Math.min(10,remaining));
   if(services.search&&selected.length&&now()+25000<deadline){for(let i=0;i<selected.length&&state.phase==='ai'&&httpRequests<16&&now()+25000<deadline;i+=5){const batch=selected.slice(i,i+5);for(const p of batch){state.aiAttempted.push(p.id);state.aiVisited.push(p.id);markAttempt(p.id)}await saveState();
     let links:PriceLink[];try{httpRequests++;links=await services.search(batch,deadline-now()-1000)}catch(error){state.report.message=priceSweepFailureMessage(error);await finalise(state.updatedIds.length?'partial':'failed',state.report.message);break}
     const writes:D1PreparedStatement[]=[];for(const link of links){if(now()+1000>=deadline)break;const p=batch.find(p=>p.id===link.productId);if(!p)continue;try{const html=link.store==='XCOM'?await read(link.url):await readOther(link.url);if(!html||p.mpn&&!matchesMpn(html,p.mpn)||!p.mpn&&!p.offers.some(o=>o.url===link.url&&o.store===link.store))continue;const v=stagePrice(p,{...parseOffer(html,link.store,link.url,new Date(now()).toISOString()),transport:'html-snapshot',identity:p.mpn?'mpn':'verified-reference',discovery:'ai-search'});if(!v)continue;if(v.review){state.pendingReviews++;writes.push(db.prepare('INSERT INTO source_health(store,checked_at,error) VALUES(?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error').bind('PRICE_REVIEW:'+p.id+':'+v.offer.store,v.offer.checkedAt,JSON.stringify(v)))}else{writes.push(...services.offerStatements([v]));state.report.updatedOffers!++;if(!state.updatedIds.includes(p.id))state.updatedIds.push(p.id)}}catch(error){if(/HTTP (401|403|429)/.test(String(error))){await finalise('partial','Источник ограничил доступ. Проверка остановлена.');break}}}
     await saveState(writes);processed+=batch.length;
    }}
   if(state.phase==='ai'&&(!services.search||!selected.length||state.aiAttempted.length>=aiProductLimit(config.AI_MAX_PRODUCTS_PER_RUN)))await finalise(state.updatedIds.length===products.length?'complete':'partial',`Обновлено ${state.updatedIds.length} из ${products.length}. Требуют проверки: ${state.pendingReviews}. Остальные даты сохранены.`);
  }
  state.portions++;state.activeDurationMs+=now()-start;state.report.attempted=state.attemptedIds.length;state.report.updated=state.updatedIds.length;state.report.skipped=Math.max(0,state.report.attempted-state.report.updated);state.report.done=state.phase==='done';state.report.cycleCompleted=state.phase==='done'&&coverageAccepted(state.seen.length,state.expected)&&state.publishOffset>=Object.keys(state.staged).length;state.report.durationMs=now()-start;state.report.totalDurationMs=now()-Date.parse(state.startedAt);state.report.activeDurationMs=state.activeDurationMs;state.report.portions=state.portions;state.report.pendingReviews=state.pendingReviews;state.report.aiProducts=state.aiAttempted.length;state.report.httpRequests=httpRequests;state.report.d1Requests=dbRequests+6;
  const attemptedIds=new Set(state.attemptedIds),updatedIds=new Set(state.updatedIds);
  state.report.categories=Object.fromEntries(categories.map(c=>[c.id,{attempted:0,updated:0}]));
  for(const product of products){
   const count=state.report.categories[product.category];
   if(attemptedIds.has(product.id))count.attempted++;
   if(updatedIds.has(product.id))count.updated++;
  }
  if(state.phase==='done'&&!state.report.finishedAt)state.report.finishedAt=new Date(now()).toISOString();await saveState(publication);await services.onReport(state.report,state.phase==='done');
  dbRequests++;await db.batch([db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SWEEP_SELECTION',?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(new Date(now()).toISOString(),JSON.stringify({attemptedIds:state.aiVisited}))]);
  console.info('Порция обновления цен',JSON.stringify({cycleId:state.id,portion:state.portions,durationMs:state.report.durationMs,totalDurationMs:state.report.totalDurationMs,processed,httpRequests}));
  return{done:state.phase==='done',cursor:currentCursor(),processed,report:state.report};
 }catch(error){if(state&&!(error instanceof SweepIntervalError)){const failed={...state.report,status:'failed' as const,done:false,cycleCompleted:false,message:priceSweepFailureMessage(error)};try{await services.onReport(failed,false)}catch{console.error('Не удалось сохранить причину ошибки обновления')}}throw error}
 finally{await db.batch([db.prepare('UPDATE source_health SET blocked_until=NULL WHERE store=? AND error=?').bind(LEASE,leaseToken)])}
}
