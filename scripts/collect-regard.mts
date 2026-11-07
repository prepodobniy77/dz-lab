/** Collect public Regard listing pages (including variants rendered in the listing). */
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {robotsPolicy} from '../lib/robots-policy.ts';
import {parseRegardListing, regardCategories, regardListUrl} from '../lib/regard-listing.mts';
const root='https://www.regard.ru';
const dir='.sites-runtime/store-snapshots';
const ua='DZLAB-Catalog/1.0 (price-check; +https://dz-lab.dimkaaistov.workers.dev/)';
await mkdir(dir,{recursive:true});
async function read(url:string){
 const r=await fetch(url,{headers:{'User-Agent':ua},redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const retry=r.headers.get('retry-after');await r.body?.cancel();throw Error('HTTP '+r.status+' '+url+(retry?' Retry-After: '+retry:''));}
 if(Number(r.headers.get('content-length'))>10_000_000)throw Error('Oversized page');
 return await r.text();
}
const robots=robotsPolicy(await read(root+'/robots.txt'));
let last=Date.now();
for(const [category,id,slug] of regardCategories){
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
  const url=regardListUrl(id,slug,page);
  if(!robots.allows(url))throw Error('robots.txt excludes '+url);
  await sleep(Math.max(0,Math.max(robots.delayMs,7000)-(Date.now()-last)));
  last=Date.now();
  const html=await read(url);
  const listing=parseRegardListing(html,category,id,page,url);
  pages=listing.pages;
  const checkedAt=new Date().toISOString();
  await writeFile(file+'.tmp',JSON.stringify({store:'REGARD',region:'Москва',category,url,page,checkedAt,...listing}));
  await rename(file+'.tmp',file);
  console.log(category,page+'/'+pages,'listed',listing.listed.length,'variants',listing.items.length-listing.listed.length);
 }
}
