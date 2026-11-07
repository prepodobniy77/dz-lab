/** Import dated Moscow retail listings collected from public catalog pages. */
import {readFile, readdir, writeFile, rename, open, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readSpecs, matchesMpn} from '../lib/providers.mts';
import {desktopCatalog, isSodimm} from '../lib/catalog-scope.ts';
import {isAllowedStoreUrl} from '../lib/stores.ts';
import type {CatalogData, Category, Offer, Product} from '../lib/catalog-types.ts';

type Store = 'REGARD' | 'CITILINK';
type Row = {sku:string; name:string; description:string; brand?:string; mpn?:string; url:string; image?:string; price:number|null; availability?:Offer['availability']; excluded?:boolean};
type Page = {store:Store; category:Category; region:string; url:string; checkedAt:string; page:number; pages:number; expected:number; items:Row[]; listed?:string[]; next?:string|null};
type Observation = {row:Row; page:Page; category:Category; condition?:string};
const roots = {REGARD:'https://www.regard.ru/catalog/1536/komplektuyushchie-dlya-pk', CITILINK:'https://www.citilink.ru/catalog/komplektuyuschie-dlya-pk/'};
const mainCategories:Category[] = ['cpu','motherboard','gpu','ram','ssd','hdd','psu','case','cooler'];
const apply = process.argv.includes('--apply');
const folder = resolve(process.argv.find(a=>a.startsWith('--snapshots='))?.slice(12)||'.sites-runtime/store-snapshots');
const lockPath = '.sites-runtime/all-stores-prices.lock';
const timestamp = new Date().toISOString();
const clean = (s:string) => s.replace(/\s+/g,' ').trim();
const normalizeMpn = (s:string) => clean(s).toUpperCase();
const isMpn = (s:string) => /^[A-Z0-9][A-Z0-9._+ /-]{3,79}$/i.test(s)&&/\d/.test(s)&&!/^(?:M\d+|\d{4}|\d+x\d+|DDR\d)$/i.test(s);
function exactMpn(evidence:string, mpn:string){
 const marker=mpn.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&');
 return new RegExp('(?<![-A-Za-z0-9._+/])'+marker+'(?![-A-Za-z0-9_+/]|[.][A-Za-z0-9])','i').test(evidence);
}
const conditionOf = (s:string) => /уцен|витрин|восстановлен|(?:^|\W)refurbished\b|б\/у|\[M\d+\]/i.test(s) ? 'Уценённый или восстановленный товар' : undefined;
const pack = (s:string) => /\b(?:OEM|TRAY)\b/i.test(s)?'OEM':/\b(?:BOX|WOF|RET(?:AIL)?)\b/i.test(s)?'BOX':'';
const liquid = /жидкост|водян|СЖО|\b(?:AIO|Liquid Freezer)\b/i;
const idFor = (url:string,store:Store) => isAllowedStoreUrl(url,store)?new URL(url).pathname.match(store==='REGARD'?/^\/product\/(\d+)\/[\w-]+\/?$/:/^\/product\/[\w-]+-([a-z]?\d+)\/?$/i)?.[1].toLowerCase():undefined;
function imageOf(raw:string|undefined, store:Store){
 try{const url=new URL(raw||'');if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
  (store==='CITILINK'?url.hostname==='cdn.citilink.ru':url.hostname==='www.regard.ru'&&url.pathname.startsWith('/api/site/cacheimg/goods/')))return url.href}catch{}
 return '';
}
function sourceSpecs(row:Row,category:Category){
 const text=row.name+' '+row.description, specs=readSpecs(row.name,row.description,category);
 if(category==='cpu'||category==='motherboard'){
  const socket=text.match(/\b(AM[2-5]\+?|FM[12]\+?|(?:LGA|sTR|TR|SP)\s?\d{1,4}(?:-\d)?|s?TRX[458]0)\b/i)?.[1];
  if(socket)specs.socket=socket.toUpperCase().replace(/\s+/g,'');
 }
 if(['ram','motherboard'].includes(category)){
  const memory=text.match(/DDR([2-5])\b/i)?.[1];if(memory)specs.memory='DDR'+memory;
 }
 if(category==='ram'){
  const capacity=row.name.match(/(?:(\d+)\s*[xх×]\s*)?(\d+)\s*(?:GB|ГБ)/i);
  if(capacity)specs.capacity=Number(capacity[1]||1)*Number(capacity[2]);
 }
 if(category==='gpu')specs.gpuLength ||= Number(row.description.match(/(?:^|,\s*)длина(?: видеокарты)?\s*[:–-]?\s*(\d+)\s*мм/i)?.[1])||undefined;
 if(category==='psu')specs.watts ||= Number(text.match(/(?:^|[\s(])(\d{2,4})\s*(?:Вт|W)(?:$|[\s,.)])/i)?.[1])||undefined;
 if(category==='cpu'){
  specs.cores ||= Number(row.description.match(/(\d+)\s*(?:ядер\b|ядерн|ядра|ядер,)/i)?.[1])||undefined;
  specs.tdp ||= Number(row.description.match(/\bTDP\s*:?\s*(\d+)\s*Вт/i)?.[1])||undefined;
 }
 return specs;
}

const lock=await open(lockPath,'wx');
try {
 const data:CatalogData=desktopCatalog(JSON.parse(await readFile('data/catalog.json','utf8')));
 if(data.region!=='Москва')throw Error('Target catalog region must be Moscow');
 const pages = new Map<string,Page[]>();
 for(const file of (await readdir(folder)).filter(name=>/^(REGARD|CITILINK)-[a-z]+-\d+\.json$/.test(name))){
  const p:Page=JSON.parse(await readFile(resolve(folder,file),'utf8'));
  const age=Date.parse(timestamp)-Date.parse(p.checkedAt);
  if(!Object.hasOwn(roots,p.store)||p.region!=='Москва'||!isAllowedStoreUrl(p.url,p.store)||!new URL(p.url).pathname.startsWith('/catalog/')||
   ![...mainCategories,'aio'].includes(p.category)||file!==p.store+'-'+p.category+'-'+p.page+'.json'||
   !Number.isSafeInteger(p.page)||!Number.isSafeInteger(p.pages)||p.page<1||p.page>p.pages||
   !Number.isSafeInteger(p.expected)||p.expected<0||!Array.isArray(p.items)||!Number.isFinite(age)||age< -300000)throw Error('Invalid snapshot: '+file);
  if(age>86400000)continue;
  const key=p.store+':'+p.category;
  pages.set(key,[...pages.get(key)||[],p]);
 }
 const selected=new Map<string,Observation>();
 const conflicts=new Set<string>();
 const coverage=[];
 const registered=new Map<string,Product>();
 const duplicates=new Set<string>();
 const mpnIndex=new Map<string,Product[]>();
 const brands=[...new Set(data.products.map(p=>p.brand).filter(b=>b.length>1))].sort((a,b)=>b.length-a.length);
 for(const p of data.products){
  if(p.mpn){const key=p.category+':'+normalizeMpn(p.mpn);mpnIndex.set(key,[...mpnIndex.get(key)||[],p]);}
  for(const o of p.offers){
   if(o.store!=='REGARD'&&o.store!=='CITILINK')continue;
   const sku=idFor(o.url,o.store);
   if(sku){const key=o.store+':'+sku;if(registered.has(key)&&registered.get(key)!==p)duplicates.add(key);registered.set(key,p);}
  }
 }
 for(const store of ['REGARD','CITILINK'] as const){
  const categories=store==='REGARD'?[...mainCategories,'aio' as const]:mainCategories;
  for(const category of categories){
   const group=(pages.get(store+':'+category)||[]).sort((a,b)=>a.page-b.page);
   const first=group[0];
   const seen=new Set<string>(), listed=new Set<string>();
   let visible=0, repeated=0, priced=0, unpriced=0, excludedSodimm=0, outsideScope=0;
   for(const p of group){
    const main=p.listed??p.items.map(row=>row.sku);
    visible+=main.length;main.forEach(sku=>listed.add(sku));
    for(const row of p.items){
     if(!row||typeof row.name!=='string'||!row.name.trim()||typeof row.description!=='string'||
      typeof row.sku!=='string'||idFor(row.url,store)!==row.sku.toLowerCase()||
      (row.price!==null&&(!Number.isFinite(row.price)||row.price<=0||row.price>10_000_000))||
      (row.availability&&!['in-stock','out-of-stock','unknown'].includes(row.availability)))throw Error('Invalid listing item: '+p.url+' '+JSON.stringify(row).slice(0,200));
     const evidence=row.name+' '+row.description+' '+new URL(row.url).pathname;
     const key=store+':'+row.sku.toLowerCase();
     const soDimm=row.excluded||isSodimm({category,name:row.name,description:evidence});
     const actual=category==='cooler'&&liquid.test(evidence)?'aio':category;
     const outside=(category==='ram'&&store==='CITILINK'&&!/\b(?:DIMM|UDIMM|RDIMM|LRDIMM)\b/i.test(evidence))||
      (category==='cooler'&&actual==='cooler'&&!/кулер|охлаждение/i.test(row.name));
     if(seen.has(row.sku)){repeated++;}else{
      if(soDimm)excludedSodimm++;
      else if(row.price===null)unpriced++;
      else if(outside)outsideScope++;
      else priced++;
      seen.add(row.sku);
     }
     if(soDimm||outside)continue;
     const condition=conditionOf(evidence)??(store==='CITILINK'&&/^m\d+$/i.test(row.sku)?'Уценённый товар':undefined);
     const previous=selected.get(key);
     if(previous&&(previous.category!==actual||previous.condition!==condition||
       (clean(previous.row.name)!==clean(row.name)&&previous.row.price!==row.price))){conflicts.add(key);continue;}
     if(!previous||((row.price!==null||previous.row.price===null)&&p.checkedAt>=previous.page.checkedAt))selected.set(key,{row,page:p,category:actual,condition});
    }
   }
   coverage.push({store,category,url:first?.url??null,expected:first?.expected??null,pages:group.length,
    expectedPages:first?.pages??null,complete:!!first&&group.length===first.pages&&group.every((p,i)=>p.page===i+1&&p.pages===first.pages&&p.expected===first.expected)&&visible===first.expected,
    visible,uniqueListingCards:listed.size,variants:seen.size-listed.size,duplicates:repeated,priced,unpriced,excludedSodimm,outsideScope});
  }
 }
 const counts={REGARD:{priced:0,added:0,matched:0,conflicts:0,unpriced:0},CITILINK:{priced:0,added:0,matched:0,conflicts:0,unpriced:0}};
 const exclusions=new Set<string>();
 for(const [key,{row,page,category,condition}] of selected){
  const {store,checkedAt}=page, stats=counts[store];
  if(conflicts.has(key)||duplicates.has(key)){stats.conflicts++;continue;}
  const title=clean(row.name);
  const description=clean(row.description===title?'':row.description);
  const brand=clean(row.brand||brands.find(b=>matchesMpn(title,b))||'');
  const evidence=title+' '+description;
  const explicit=[row.mpn||'', ...[...evidence.matchAll(/\[([^\]]+)\]|\(([^()]+)\)/g)].map(m=>m[1]||m[2])].map(clean).find(v=>isMpn(v)&&!/^\d+(?:[.,]\d+)?(?:[xх]\d+)?\s*(?:GB|TB|MHz|GHz|mm)\b/i.test(v));
  let mpn=explicit||'';
  let product=registered.get(key);
  if(product&&product.category!==category){stats.conflicts++;continue;}
  if(product&&condition&&product.offers.some(o=>o.store!==store&&!o.condition)){stats.conflicts++;continue;}
  if(!product&&!condition&&brand){
   const candidates = mpn
    ? mpnIndex.get(category+':'+normalizeMpn(mpn))||[]
    : data.products.filter(p=>p.category===category&&p.brand.toLowerCase()===brand.toLowerCase()&&isMpn(p.mpn)&&exactMpn(evidence,p.mpn));
   const eligible=candidates.filter(p=>p.brand.toLowerCase()===brand.toLowerCase()&&!conditionOf(p.name)&&!p.offers.some(o=>o.store===store||o.condition)&&
    (category!=='cpu'||pack(p.name+' '+p.description)===pack(evidence)));
   if(eligible.length===1){product=eligible[0];mpn ||= product.mpn;stats.matched++;}
  }
  if(row.price===null){
   stats.unpriced++;
   const offer=product?.offers.find(o=>o.store===store&&idFor(o.url,store)===row.sku.toLowerCase());
   if(offer&&row.availability==='out-of-stock'&&Date.parse(checkedAt)>=Date.parse(offer.checkedAt)){
    const lastSuccessAt=offer.lastSuccessAt||(offer.status==='ok'?offer.checkedAt:undefined);
    Object.assign(offer,{price:null,status:'error',availability:'out-of-stock',checkedAt,lastSuccessAt,error:'В каталоге магазина нет актуальной цены.'});
   }
   continue;
  }
  if(!product){
   const specs=sourceSpecs(row,category);
   if(isSodimm({category,name:title,description,specs})){exclusions.add(key);continue;}
   const attributes:Record<string,string>={};
   if(category==='aio'&&specs.radiatorSize)attributes['Размер радиатора']=specs.radiatorSize+' мм';
   const name=title.replace(/^(?:Процессор|Материнская плата|Видеокарта|Оперативная память|Блок питания|Корпус)\s+/i,'');
   product={id:store.toLowerCase()+'-'+row.sku,category,name,description,mpn,brand,specs,image:imageOf(row.image,store),offers:[],...(Object.keys(attributes).length?{attributes}:{})};
   if(data.products.some(p=>p.id===product!.id))throw Error('Catalog ID collision '+product.id);
   data.products.push(product);stats.added++;
  }
  const previous=product.offers.find(o=>o.store===store);
  if(previous&&Date.parse(previous.checkedAt)>Date.parse(checkedAt))continue;
  const u=new URL(row.url);u.search='';u.hash='';
  const offer:Offer={store,url:u.href,price:row.price,checkedAt,status:'ok',transport:'html-snapshot',availability:row.availability??'unknown',...(condition?{condition}:{})};
  product.offers=product.offers.filter(o=>o.store!==store);product.offers.push(offer);
  registered.set(key,product);stats.priced++;
 }
 for(const store of ['REGARD','CITILINK'] as const){
  const sections=coverage.filter(r=>r.store===store), stats=counts[store];
  if(!stats.priced)continue;
  const checkedAt=[...pages.values()].flat().filter(p=>p.store===store).map(p=>p.checkedAt).sort().at(-1)!;
  const complete=sections.every(r=>r.complete)&&!stats.conflicts;
  const status=complete?'ok':'partial';
  const count=(n:number)=>n.toLocaleString('ru-RU');
  const note='Москва. '+count(stats.priced)+' цен из публичного каталога. '+
   (complete?'Просмотрены все страницы разделов комплектующих.':'Часть страниц или карточек не удалось подтвердить.')+
   ' Цены на SO-DIMM исключены; дата проверки указана у каждого предложения.';
  const source=data.sources.find(s=>s.name===store);
  const update={name:store,status,note,checkedAt,url:roots[store]};
  if(source)Object.assign(source,update);else data.sources.push(update);
 }
 const report={checkedAt:timestamp,region:'Москва',products:data.products.length,counts,excludedInSpecs:exclusions.size,coverage};
 if(!selected.size)throw Error('No recent public store snapshots');
 if(apply){
  data.importedAt=timestamp;
  for(const [file,value] of [['data/catalog.json',data],['data/store-coverage.json',report]] as const){
   await writeFile(file+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(file+'.tmp',file);
  }
 }
 console.log(JSON.stringify(report,null,2));
} finally {await lock.close();await unlink(lockPath);}
