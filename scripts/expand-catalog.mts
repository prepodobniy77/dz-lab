import {readFile,writeFile} from 'node:fs/promises';
import {CATALOG_URLS,parseXcomCatalog,fetchHtml} from '../lib/providers.mts';
import type {CatalogData,Category,Product} from '../lib/catalog-types';
const data:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
const map=new Map(data.products.map(p=>[p.id,p]));
const report:unknown[]=[];let blocked=false;
// Additive import: keep detailed specs and all other merchants. Capture listing snapshots
// separately from the API price updater; never claim these observations are API data.
const jobs=(Object.keys(CATALOG_URLS) as Category[]).flatMap(category=>[
 ...[1,2,3,4,5,6].map(page=>({category,page,sort:''})),
 ...['asc','desc'].map(sort=>({category,page:1,sort}))
]);
for(const job of jobs){if(blocked)break;const query=new URLSearchParams();if(job.page>1)query.set('catalog',`page-${job.page}`);if(job.sort){query.set('sort','p');query.set('direction',job.sort)}
try{const html=await fetchHtml(CATALOG_URLS[job.category]+(query.size?'?'+query:''));const items=parseXcomCatalog(html,job.category).filter(p=>{
 if(['cpu','motherboard'].includes(p.category))return ['AM4','AM5','LGA1700','LGA1851'].includes(p.specs.socket||'');
 if(p.category==='ram')return /DDR[45]/.test(p.specs.memory||'')&&!/SO.?DIMM|ECC|Registered|RDIMM/i.test(p.name+' '+p.description);
 if(p.category==='gpu')return /RTX|GTX|GT\s?\d|RX\s?\d|Arc/i.test(p.name);
 if(p.category==='hdd')return /SATA/i.test(p.name+' '+p.description)&&!/SAS|SSD|SCSI|внешний|USB/i.test(p.name+' '+p.description);
 if(p.category==='aio')return /жидкост|водян|СЖО/i.test(p.name);
 return true;
});for(const p of items){const old=map.get(p.id);p.offers.forEach(o=>o.transport='html-snapshot');if(old){map.set(p.id,{...p,...old,offers:[...old.offers.filter(o=>o.store!=='XCOM'),...p.offers]})}else map.set(p.id,p)}report.push({...job,count:items.length});console.log(job.category,job.page,job.sort||'default',items.length,'total',map.size)}catch(e){const error=String(e);report.push({...job,error});console.log(job.category,error);if(/HTTP (401|403|429)/.test(error))blocked=true}
await new Promise(r=>setTimeout(r,350));}
data.products=[...map.values()];for(const p of data.products)for(const o of p.offers)o.transport||='html-snapshot';data.importedAt=new Date().toISOString();
await writeFile('data/catalog.json',JSON.stringify(data,null,2));await writeFile('data/expansion-report.json',JSON.stringify({checkedAt:data.importedAt,report,counts:Object.fromEntries(Object.keys(CATALOG_URLS).map(c=>[c,data.products.filter(p=>p.category===c).length]))},null,2));console.log('FINAL',data.products.length);
