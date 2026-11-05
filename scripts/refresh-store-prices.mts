import {readFile, writeFile, mkdir, rename, open, unlink} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {CATALOG_URLS, parseXcomCatalog, parseOffer, matchesMpn, primaryJsonLdProduct} from '../lib/providers.mts';
import {robotsPolicy} from '../lib/robots-policy.ts';
import {stores, isAllowedStoreUrl, type StoreId} from '../lib/stores.ts';
import type {CatalogData, Offer, Product, Category} from '../lib/catalog-types.ts';

// One sequential worker per store, shared across bulk, known and discovered URLs.
const statePath='.sites-runtime/all-stores-prices.json';
const ua='DZLAB-Catalog/1.0 (price-check; +https://dz-lab.dimkaaistov.workers.dev/)';
type Observation={productId:string;offer:Offer};
type SourceReport={store:StoreId;requests:number;updated:number;failures:number;review:number;blocked?:string;finished?:boolean};
type State={startedAt:string;finishedAt?:string;observations:Observation[];reports:SourceReport[]};
type Discovery={productId:string;store:StoreId;result?:{url:string|null;price:number|null;confidence:number;needs_manual_review:boolean};error?:string};
const discoveryOnly=process.argv.includes('--discovery-only');
const data:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
const discovered:Discovery[]=process.env.DZ_DISCOVERY_FILE?JSON.parse(await readFile(process.env.DZ_DISCOVERY_FILE,'utf8')):[];
const state:State=process.argv.includes('--resume')?JSON.parse(await readFile(statePath,'utf8')):{startedAt:new Date().toISOString(),observations:[],reports:[]};
if(process.argv.includes('--resume')&&Date.now()-Date.parse(state.startedAt)>24*60*60*1000)throw new Error('Saved cycle is older than 24 hours; start without --resume');
const completed=new Set(state.observations.map(o=>o.productId+':'+o.offer.store));
const norm=(value:string)=>value.replace(/\s/g,'').toUpperCase();
await mkdir('.sites-runtime',{recursive:true});
const lockPath='.sites-runtime/all-stores-prices.lock';
const lock=await open(lockPath,'wx').catch(()=>{throw new Error('Another refresh holds the lock; check the running job before removing '+lockPath)});
let saving=Promise.resolve();
function save(){
 const json=JSON.stringify(state,null,2);
 saving=saving.then(async()=>{await writeFile(statePath+'.tmp',json);await rename(statePath+'.tmp',statePath)});
 return saving;
}
async function responseText(response:Response){
 if(Number(response.headers.get('content-length'))>5_000_000)throw new Error('Ответ превышает 5 МБ');
 const reader=response.body?.getReader();if(!reader)throw new Error('Пустой ответ');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5_000_000)throw new Error('Ответ превышает 5 МБ');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const charset=/windows-1251|cp1251/i.test(response.headers.get('content-type')||'')?'windows-1251':'utf-8';
 return new TextDecoder(charset).decode(bytes);
}
async function runStore(store:typeof stores[number]){
 if(store.id==='DELECT')return;
 let report=state.reports.find(r=>r.store===store.id);
 if(report?.finished&&!discoveryOnly)return;
 if(report?.blocked)return;
 if(!report){report={store:store.id,requests:0,updated:0,failures:0,review:0};state.reports.push(report)}
 const r=report;let lastRequest=0;let policy:ReturnType<typeof robotsPolicy>;
 const read=async(url:string)=>{
  if(r.blocked)throw new Error(r.blocked);
  if(!isAllowedStoreUrl(url,store.id))throw new Error('Домен ссылки не разрешён');
  if(!policy.allows(url))throw new Error('robots.txt запрещает путь');
  await pause(Math.max(0,policy.delayMs-(Date.now()-lastRequest)));lastRequest=Date.now();r.requests++;
  const response=await fetch(url,{headers:{'User-Agent':ua,Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([401,403,429].includes(response.status)){r.blocked='Магазин ограничил доступ: HTTP '+response.status;await response.body?.cancel();throw new Error(r.blocked)}
  if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status)}
  const html=await responseText(response);
  if(/<title[^>]*>[^<]*(?:captcha|access denied|just a moment|доступ ограничен|проверка браузера)/i.test(html)){r.blocked='Проверка доступа на стороне магазина';throw new Error(r.blocked)}
  return html;
 };
 const record=(p:Product,offer:Offer)=>{
  if(completed.has(p.id+':'+store.id))return;
  const old=p.offers.find(o=>o.store===store.id);
  if(!offer.price||old?.price&&Math.abs(offer.price-old.price)/old.price>0.5){r.review++;return}
  const {error:oldError,requiresReview:oldReview,...previous}=old||{};
  state.observations.push({productId:p.id,offer:{...previous,...offer,transport:'html-snapshot',identity:p.mpn?'mpn':'verified-reference'}});
  completed.add(p.id+':'+store.id);r.updated++;
 };
 try{
  const robots=await fetch(new URL('/robots.txt',store.url),{headers:{'User-Agent':ua},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(robots.status===404){await robots.body?.cancel();policy=robotsPolicy('')}
  else if(robots.ok)policy=robotsPolicy(await responseText(robots));
  else{await robots.body?.cancel();throw new Error('Не удалось проверить robots.txt: HTTP '+robots.status)}
  if(store.id==='XCOM'&&!discoveryOnly){
   for(const [category,url] of Object.entries(CATALOG_URLS)){
    if(r.blocked)break;
    for(let page=1;page<=6&&!r.blocked;page++){
     try{
      const html=await read(url+(page===1?'':'?catalog=page-'+page));
      const items=parseXcomCatalog(html,category as Category);
      if(!items.length)break;
      for(const item of items){const p=data.products.find(p=>p.id===item.id);if(!p||p.mpn&&norm(p.mpn)!==norm(item.mpn))continue;record(p,item.offers[0])}
      await save();console.log(store.id,category,page,'updated',r.updated);
     }catch(error){r.failures++;console.log(store.id,category,String(error));break}
    }
   }
  }
  const candidates=discoveryOnly?[]:data.products.flatMap(p=>p.offers.filter(o=>o.store===store.id&&!completed.has(p.id+':'+store.id)).map(o=>({p,url:o.url})));
  for(const d of discovered.filter(d=>d.store===store.id&&d.result?.url)){
   const p=data.products.find(p=>p.id===d.productId);if(p&&!completed.has(p.id+':'+store.id)&&!candidates.some(c=>c.p.id===p.id))candidates.push({p,url:d.result!.url!});
  }
  for(const {p,url} of candidates){
   if(r.blocked)break;
   try{
    const html=await read(url);
    const main=primaryJsonLdProduct(html);
    const identity=[html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',main?.mpn,main?.sku,main?.name].filter(Boolean).join(' ');
    if(p.mpn&&!matchesMpn(identity,p.mpn))throw new Error('Артикул основного товара не подтверждён');
    if(!p.mpn&&!p.offers.some(o=>o.store===store.id&&o.url===url))throw new Error('Неизвестный товар без артикула');
    const offer=parseOffer(html,store.id,url);
    record(p,offer);
   }catch(error){r.failures++;console.log(store.id,p.id,String(error))}
   await save();
   if(r.requests%25===0)console.log(store.id,'requests',r.requests,'updated',r.updated);
  }
  if(!candidates.length&&store.id!=='XCOM'){
   // A root page can establish access, but cannot establish a product price.
   try{await read(store.url)}catch{r.failures++}
  }
 }catch(error){r.blocked=String(error)}
 r.finished=true;await save();console.log('FINISHED',JSON.stringify(r));
}
try{
await Promise.all(stores.map(runStore));
state.finishedAt=new Date().toISOString();await save();
if(process.argv.includes('--apply')){
 const current:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
 for(const observation of state.observations){
  const p=current.products.find(p=>p.id===observation.productId);if(!p)continue;
  const old=p.offers.find(o=>o.store===observation.offer.store);
  if(old&&old.checkedAt>observation.offer.checkedAt)continue;
  if(old?.price&&observation.offer.price&&Math.abs(observation.offer.price-old.price)/old.price>0.5)continue;
  p.offers=p.offers.filter(o=>o.store!==observation.offer.store);p.offers.push(observation.offer);
 }
 for(const report of state.reports){
  const source=current.sources.find(s=>s.name===report.store);if(!source)continue;
  source.checkedAt=state.finishedAt;
  source.status=report.updated?'partial':report.blocked?'limited':'unavailable';
  source.note=`Проверено запросов: ${report.requests}; обновлено цен: ${report.updated}; требуется проверка: ${report.review}. ${report.blocked||''}`;
 }
 // Atomic replacement, keeping the previous snapshot until validation finishes.
 await writeFile('data/catalog.json.tmp',JSON.stringify(current,null,2)+'\n');await rename('data/catalog.json.tmp','data/catalog.json');
}
console.log('SUMMARY',JSON.stringify(state.reports));
}finally{await lock.close();await unlink(lockPath)}
