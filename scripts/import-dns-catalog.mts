import {readFile, readdir, writeFile, rename, mkdir, open, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isSodimm} from '../lib/catalog-scope.ts';
import {readSpecs} from '../lib/providers.mts';
import {isAllowedStoreUrl} from '../lib/stores.ts';
import {categories} from '../lib/catalog.ts';
import type {CatalogData, Product, Category, Offer} from '../lib/catalog-types.ts';

type Row = {
  guid:string; sku:string; name:string; url:string; priceText:string|null;
  availability:string; availabilityText:string; image:string;
  attributes:Record<string,string>; checkedAt?:string; transport?:'api'|'html-snapshot';
};
type Snapshot = {
  source:string; category:Category; region:string; url:string; title:string;
  checkedAt:string; items:Row[];
  sections?:{url:string;expected:number;loaded:number;checkedAt:string}[];
};
const directory = resolve(process.argv[2] || '.sites-runtime/dns-full');
const apply = process.argv.includes('--apply');
await mkdir('.sites-runtime',{recursive:true});
const lockPath = '.sites-runtime/all-stores-prices.lock';
const lock = await open(lockPath,'wx');
try {
  const coverage=await readFile(resolve(directory,'../dns-coverage.json'),'utf8').then(JSON.parse).catch(()=>null);
  const complete=Array.isArray(coverage)&&coverage.length===12&&coverage.every((r:any)=>r.complete&&r.priced===r.expected);
  if(apply&&directory.endsWith('dns-normalized')&&!complete)throw Error('Full DNS import requires complete validated coverage for all 12 desktop catalog sections');
  const data:CatalogData = JSON.parse(await readFile('data/catalog.json','utf8'));
  data.products=data.products.filter(p=>!isSodimm(p));
  const previousIds = new Set(data.products.map(p=>p.id));
  const byCode = new Map<string,Product>();
  const code = (url:string) => new URL(url).pathname.match(/^\/product\/([a-f0-9]{16})\//)?.[1];
  for (const product of data.products) {
    for (const offer of product.offers.filter(o=>o.store==='DNS')) {
      const id=code(offer.url); if(id)byCode.set(id,product);
    }
  }
  const byMpn = new Map<string,Product[]>();
  for (const product of data.products) {
    if(!product.mpn)continue;
    const key=product.mpn.trim().toUpperCase();
    byMpn.set(key,[...(byMpn.get(key)||[]),product]);
  }
  const knownBrands = [...new Set(data.products.map(p=>p.brand).filter(b=>b.length>1))];
  const brandOf = (name:string) => knownBrands.map(brand=>({brand,index:name.toLowerCase().indexOf(brand.toLowerCase())}))
    .filter(item=>item.index>=0).sort((a,b)=>a.index-b.index||b.brand.length-a.brand.length)[0]?.brand||'';
  const report:{category:Category;items:number;priced:number;unpriced:number;added:number;updated:number;sections:Snapshot['sections']}[]=[];
  const observed = new Set<string>();
  for (const file of (await readdir(directory)).filter(f=>f.endsWith('.json')).sort()) {
    const snapshot:Snapshot=JSON.parse(await readFile(resolve(directory,file),'utf8'));
    if(!['public-browser-catalog','validated-dns-catalog'].includes(snapshot.source)||snapshot.region!=='Москва'||!categories.some(c=>c.id===snapshot.category))throw new Error('Invalid category snapshot: '+file);
    if(snapshot.category==='ram'&&(/17a9b91b16404e77/.test(snapshot.url)||isSodimm({category:'ram',name:snapshot.title})))continue;
    const checked=Date.parse(snapshot.checkedAt);
    if(!Number.isFinite(checked)||checked>Date.now()+300000||Date.now()-checked>86400000)throw new Error('Stale snapshot: '+file);
    if(!isAllowedStoreUrl(snapshot.url,'DNS')||!Array.isArray(snapshot.items))throw new Error('Invalid snapshot source: '+file);
    const entry={category:snapshot.category,items:0,priced:0,unpriced:0,added:0,updated:0,sections:snapshot.sections};
    for (const row of snapshot.items) {
      if(!row||typeof row.name!=='string'||!row.name.trim()||!isAllowedStoreUrl(row.url,'DNS'))throw new Error('Invalid product in '+file);
      if(isSodimm({...row,category:snapshot.category}))continue;
      const id=code(row.url); if(!id)throw new Error('Missing DNS product ID');
      if(observed.has(id))continue;
      observed.add(id);entry.items++;
      const rowCheckedAt=row.checkedAt||snapshot.checkedAt;
      const rowChecked=Date.parse(rowCheckedAt);
      if(!Number.isFinite(rowChecked)||rowChecked>Date.now()+300000||Date.now()-rowChecked>86400000)throw Error('Stale row '+id);
      const raw=(row.priceText||'').trim();
      const price=/^\d[\d\s\u00a0\u202f]*\s*₽$/.test(raw)?Number(raw.replace(/[^\d]/g,'')):null;
      if(price!==null&&(!Number.isFinite(price)||price<1||price>10000000))throw new Error('Invalid price for '+id);
      const name=row.name.replace(/\s*\[[^\]]*\]/g,'').replace(/\s+/g,' ').trim();
      const mpn=[...row.name.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1].trim()).find(v=>/^[A-Za-z0-9][A-Za-z0-9._+\/-]{3,}$/.test(v)&&/\d/.test(v))||'';
      let product=byCode.get(id);
      if(!product&&mpn){
        const matches=byMpn.get(mpn.toUpperCase())||[];
        if(matches.length===1&&matches[0].category===snapshot.category&&!matches[0].offers.some(o=>o.store==='DNS'&&code(o.url)!==id))product=matches[0];
      }
      if(!product){
        const description=Object.entries(row.attributes||{}).map(([k,v])=>k+': '+v).join('; ');
        const specs=readSpecs(row.name,description,snapshot.category);
        const socket=row.attributes?.['Сокет'];
        if(socket&&(snapshot.category==='cpu'||snapshot.category==='motherboard'))specs.socket=socket.replace(/\s+/g,'');
        if(socket&&(snapshot.category==='aio'||snapshot.category==='cooler'))specs.sockets=socket.split(',').map(v=>v.trim().toUpperCase().replace(/\s+/g,''));
        const cores=Number(row.attributes?.['Общее количество ядер']);if(snapshot.category==='cpu'&&cores>0)specs.cores=cores;
        if(snapshot.category==='psu'){
          const value=Object.entries(row.attributes||{}).find(([k])=>/^Мощность/i.test(k))?.[1];
          const watts=Number(value?.match(/\d+/)?.[0]);if(watts>0)specs.watts=watts;
        }
        product={id:'dns-'+id,category:snapshot.category,name,brand:brandOf(name),mpn,image:row.image||'',specs,description,attributes:row.attributes||{},offers:[]};
        data.products.push(product);byCode.set(id,product);entry.added++;
      }else{entry.updated++;byCode.set(id,product);
        if(product.id.startsWith('dns-')&&(snapshot.category==='aio'||snapshot.category==='cooler')){delete product.specs.socket;const socket=row.attributes?.['Сокет'];if(socket)product.specs.sockets=socket.split(',').map(v=>v.trim().toUpperCase().replace(/\s+/g,''));}
      }
      const previous=product.offers.find(o=>o.store==='DNS');
      if(previous&&Date.parse(previous.checkedAt)>rowChecked)continue;
      if(previous?.price&&price===null)continue;
      const offer:Offer={
        store:'DNS',url:row.url,price,checkedAt:rowCheckedAt,transport:row.transport||'html-snapshot',
        availability:row.availability==='now'?'in-stock':/нет в наличии|товар недоступен|снят с продажи/i.test(row.availabilityText||'')?'out-of-stock':'unknown',
        status:price===null?'error':'ok',
        ...(/восстановлен|витрин|уцен/i.test(row.name)?{condition:'Состояние: '+name}:{}),
        ...(price===null?{error:'В публичном каталоге магазина цена не указана.'}:{}),
      };
      product.offers=product.offers.filter(o=>o.store!=='DNS');product.offers.push(offer);
      if(price===null)entry.unpriced++;else entry.priced++;
    }
    report.push(entry);
  }
  const source=data.sources.find(s=>s.name==='DNS');
  if(source){source.status=complete?'ok':'partial';source.checkedAt=new Date().toISOString();source.note=`Москва. Снимок публичных цен, не непрерывное обновление. ${observed.size} товаров DNS. Проверены разделы: ${report.map(r=>r.category).join(', ')}.`}
  const result={checkedAt:new Date().toISOString(),categories:report,products:data.products.length,added:data.products.filter(p=>!previousIds.has(p.id)).length,dnsProducts:observed.size};
  await writeFile('.sites-runtime/dns-catalog-import-report.json',JSON.stringify(result,null,2)+'\n');
  if(apply){await writeFile('data/catalog.json.tmp',JSON.stringify(data,null,2)+'\n');await rename('data/catalog.json.tmp','data/catalog.json')}
  console.log(JSON.stringify(result,null,2));
} finally {
  await lock.close();await unlink(lockPath);
}
