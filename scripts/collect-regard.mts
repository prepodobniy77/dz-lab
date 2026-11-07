/** Collect public Regard listing pages (including variants rendered in the listing). */
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {robotsPolicy} from '../lib/robots-policy.ts';
import {clean} from '../lib/providers.mts';
import {isSodimm} from '../lib/catalog-scope.ts';
const root='https://www.regard.ru';
const dir='.sites-runtime/store-snapshots';
const ua='DZLAB-Catalog/1.0 (price-check; +https://dz-lab.dimkaaistov.workers.dev/)';
const sources=[
 ['cpu',1001,'processory'],['motherboard',1000,'materinskie-platy'],['gpu',1013,'videokarty'],
 ['ram',1010,'operativnaya-pamyat'],['ssd',1015,'nakopiteli-ssd'],['hdd',1014,'zhestkie-diski-hdd'],
 ['psu',1225,'bloki-pitaniya'],['case',1032,'korpusa'],['cooler',5162,'kulery-dlya-processorov'],
 ['aio',1008,'zidkostnoe-oxlazdenie-szo'],
] as const;
await mkdir(dir,{recursive:true});
async function read(url:string){
 const r=await fetch(url,{headers:{'User-Agent':ua},redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const retry=r.headers.get('retry-after');await r.body?.cancel();throw Error('HTTP '+r.status+' '+url+(retry?' Retry-After: '+retry:''));}
 if(Number(r.headers.get('content-length'))>10_000_000)throw Error('Oversized page');
 return await r.text();
}
const robots=robotsPolicy(await read(root+'/robots.txt'));
let last=Date.now();
for(const [category,id,slug] of sources){
 const base=root+'/catalog/'+id+'/'+slug;
 let pages=1;
 for(let page=1;page<=pages;page++){
  const file=dir+'/REGARD-'+category+'-'+page+'.json';
  try{
   const cached=JSON.parse(await readFile(file,'utf8'));
   if(Date.now()-Date.parse(cached.checkedAt)<24*3600000){
    if(page===1)pages=cached.pages;
    continue;
   }
  }catch(error:any){if(error.code!=='ENOENT')throw error;}
  const url=base+(page===1?'':'?page='+page);
  if(!robots.allows(url))throw Error('robots.txt excludes '+url);
  await sleep(Math.max(0,Math.max(robots.delayMs,7000)-(Date.now()-last)));
  last=Date.now();
  const html=await read(url);
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';
  if(!/Москва/i.test(title))throw Error('Moscow listing title not confirmed: '+url);
  const raw=html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if(!raw)throw Error('Public listing unavailable: '+url);
  const state=JSON.parse(raw).props.initialState;
  const listing=state.listing.data[id];
  const size=state.pagination.perPage;
  const expected=listing.recordsFiltered;
  const list=listing.pages[page-1]?.data;
  if(listing.pageIndex!==page-1||!Number.isSafeInteger(expected)||expected<0||!Number.isInteger(size)||size<1||size>100||!Array.isArray(list)||list.length!==Math.max(0,Math.min(size,expected-(page-1)*size)))throw Error('Unexpected pagination: '+url);
  pages=Math.max(1,Math.ceil(expected/size));
  if(pages>300)throw Error('Unexpected catalogue size');
  const checkedAt=new Date().toISOString();
  const items=[];
  for(const main of list){
   for(const row of [main,...(main.modifications?.byChar||[])]){
    const name=clean(row.full_title||row.title||'');
    const description=clean(row.brief||'');
    if(!name||!Number.isSafeInteger(row.id)||!row.seo_url||!/^[-a-z\d]+$/i.test(row.seo_url))throw Error('Invalid listing item');
    const code=(row.vendorcode||name.match(/\(([^()]+)\)\s*$/)?.[1]||'').trim();
    const photo=row.photo||row.photos?.[0]?.name;
    items.push({
     sku:String(row.id), name, brand:row.vendor||main.vendor||'', mpn:code,
     url:root+'/product/'+row.id+'/'+row.seo_url,
     price:typeof row.price==='number'&&row.price>0?row.price:null,
     availability:row.show_flag===1&&row.preorder!==1?'in-stock':'unknown',
     description, image:/^\/?\d+$/.test(String(photo))?root+'/api/site/cacheimg/goods/'+String(photo).replace(/^\//,'')+'/160':'',
     excluded:isSodimm({category,name,description}),
    });
   }
  }
  await writeFile(file+'.tmp',JSON.stringify({store:'REGARD',region:'Москва',category,url,page,pages,expected,listed:list.map((r:any)=>String(r.id)),checkedAt,items}));
  await rename(file+'.tmp',file);
  console.log(category,page+'/'+pages,'listed',list.length,'variants',items.length-list.length);
 }
}
