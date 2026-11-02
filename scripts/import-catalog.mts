import {writeFile,mkdir} from 'node:fs/promises';
import {CATALOG_URLS,parseXcomCatalog,fetchHtml,parseOffer} from '../lib/providers.mts';
import type {Category,Product} from '../lib/catalog-types';
const categories=Object.keys(CATALOG_URLS) as Category[];
const products:Product[]=[];const results:{category:string,page:number,count?:number,error?:string}[]=[];
await mkdir('data',{recursive:true});
// Two bounded workers, one page per source at a time per worker. No protection bypass or retries.
const jobs=categories.flatMap(category=>[1,2].map(page=>({category,page})));
async function work(){while(jobs.length){const job=jobs.shift()!;const url=CATALOG_URLS[job.category]+(job.page===1?'':`?catalog=page-${job.page}`);try{const html=await fetchHtml(url);const items=parseXcomCatalog(html,job.category);products.push(...items);results.push({...job,count:items.length});console.log(job.category,job.page,items.length)}catch(e){results.push({...job,error:String(e)});console.log(job.category,job.page,String(e))}}}
await Promise.all([work(),work()]);
const unique=Array.from(new Map(products.map(p=>[p.id,p])).values());
const filtered=unique.filter(p=>{
 if(p.category==='cpu')return ['AM4','AM5','LGA1700','LGA1851'].includes(p.specs.socket||'');
 if(p.category==='motherboard')return ['AM4','AM5','LGA1700','LGA1851'].includes(p.specs.socket||'');
 if(p.category==='ram')return /DDR[45]/.test(p.specs.memory||'')&&p.specs.moduleType!=='SODIMM'&&p.specs.moduleType!=='RDIMM'&&!/SO-DIMM|SODIMM|ECC|Registered|RDIMM/i.test(p.name+' '+p.description);
 if(p.category==='gpu')return /(?:RTX|RX\s?[56789]|Arc)/i.test(p.name);
 return true;
});
const importedAt=new Date().toISOString();
await writeFile('data/catalog.json',JSON.stringify({products:filtered,importedAt,region:'Москва',sources:[{name:'XCOM',status:'ok',note:'Прямой импорт открытых страниц каталога, Москва. Два первых листа каждой категории; не весь ассортимент магазина.'},{name:'KNS',status:'pending',note:'Дополнительные предложения процессоров подключаются по точной карточке.'}]},null,2));
await writeFile('data/import-report.json',JSON.stringify({importedAt,results,rawCount:unique.length,importedCount:filtered.length},null,2));
console.log('IMPORTED',filtered.length,JSON.stringify(Object.fromEntries(categories.map(c=>[c,filtered.filter(p=>p.category===c).length]))));
