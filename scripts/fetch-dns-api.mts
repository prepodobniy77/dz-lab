import {readFile, writeFile, mkdir, rename, open, unlink} from 'node:fs/promises';
import {unlinkSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';

// Server-side only. Keep the key in the process environment, outside Git.
const apiKey=process.env.REEF_API_KEY;
if(!apiKey)throw new Error('Set REEF_API_KEY before requesting DNS data');
const creditLimit=Number(process.env.REEF_MAX_CREDITS||1000);
if(!Number.isInteger(creditLimit)||creditLimit<3||creditLimit>1000)throw new Error('Trial credit limit must be between 3 and 1000');
const sources=[
 ['cpu','Процессоры','17a899cd16404e77'],
 ['motherboard','Материнские платы','17a89a0416404e77'],
 ['gpu','Видеокарты','17a89aab16404e77'],
 ['ram','Оперативная память DIMM','17a89a3916404e77'],
 ['ssd','SSD накопители','8a9ddfba20724e77'],
 ['ssd','SSD M.2 накопители','dd58148920724e77'],
 ['hdd','Жесткие диски 3.5','17a8914916404e77'],
 ['hdd','Жесткие диски 2.5','f09d15560cdd4e77'],
 ['psu','Блоки питания','17a89c2216404e77'],
 ['case','Корпуса','17a89c5616404e77'],
 ['cooler','Кулеры для процессоров','17a9cc2d16404e77'],
 ['aio','Системы жидкостного охлаждения','17a9cc9816404e77'],
] as const;
type Job={category:string;query:string;categoryId:string;page:number};
type State={startedAt:string;creditsReserved:number;completed:string[];pending:Job[]};
const folder='.sites-runtime/reef-dns';
await mkdir(folder,{recursive:true});
const statePath=folder+'/state.json';
const lockPath=folder+'/collector.lock';
const lock=await open(lockPath,'wx');
await lock.writeFile(String(process.pid));
process.on('exit',()=>{try{unlinkSync(lockPath)}catch{}});
const plan=JSON.parse(await readFile(folder+'/active-plan.json','utf8'));
const wanted=(j:Job)=>sources.some(([, ,id])=>id===j.categoryId)&&j.page<=Math.ceil(plan.activeCounts[j.categoryId]/24)&&!(plan.browserPages[j.categoryId]||[]).includes(j.page);
let state:State;
try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(error:any){
 if(error.code!=='ENOENT')throw error;
 state={startedAt:new Date().toISOString(),creditsReserved:0,completed:[],pending:sources.map(([category,query,categoryId])=>({category,query,categoryId,page:1}))};
}
if(Date.now()-Date.parse(state.startedAt)>86400000)throw new Error('Saved API cycle is older than a day; archive it before starting a fresh run');
state.pending=state.pending.filter(wanted);
async function checkpoint(){await writeFile(statePath+'.tmp',JSON.stringify(state,null,2));await rename(statePath+'.tmp',statePath)}
async function fetchPage(job:Job){
 for(let attempt=0;attempt<3;attempt++){
  if(state.creditsReserved+3>creditLimit)throw new Error('Free trial credit budget reached. Progress is saved; no additional requests were sent.');
  // Reserve before dispatch, including uncertain timeout outcomes, to bound spend.
  state.creditsReserved+=3;await checkpoint();
  let response:Response;
  try{
   response=await fetch('https://api.reefapi.com/dns-shop/v1/search',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),
    headers:{'Content-Type':'application/json','x-api-key':apiKey!},
    body:JSON.stringify({query:job.query,page:job.page}),
   });
  }catch{
   if(attempt===2)throw new Error('DNS data provider network request failed; progress is saved');
   await pause(1000*2**attempt);continue;
  }
  if(response.status===429||response.status>=500){
   await response.body?.cancel();
   if(attempt===2)throw new Error('DNS data provider is temporarily unavailable');
   await pause(1000*2**attempt);continue;
  }
  if(!response.ok){await response.body?.cancel();throw new Error('DNS data provider returned HTTP '+response.status)}
  const payload=await response.json() as any;
  if(payload.ok!==true||payload.meta?.api!=='dns-shop'||!Array.isArray(payload.data?.results)){await writeFile(folder+'/invalid-response.json',JSON.stringify(payload));throw new Error('Invalid DNS API response; saved locally for inspection')};
  const data=payload.data;
  if(data.category_id!==job.categoryId||data.page!==job.page)throw new Error('Provider resolved a different category/page; refusing to mix products');
  if(!Number.isInteger(data.last_page)||data.last_page<job.page||data.last_page>2000)throw new Error('Invalid DNS API pagination');
  const urls=new Set<string>();
  for(const row of data.results){
   const url=new URL(row.url);
   if(url.protocol!=='https:'||url.hostname!=='www.dns-shop.ru'||!/^\/product\/[a-f0-9]{16}\//.test(url.pathname)||url.username||url.password)throw new Error('Invalid DNS source URL');
   if(urls.has(row.url))throw new Error('Duplicate product in API page');urls.add(row.url);
   if(row.price!==null&&(typeof row.price!=='number'||!Number.isFinite(row.price)||row.price<=0))throw new Error('Invalid API price');
  }
  return payload;
 }
 throw new Error('DNS data provider request failed');
}
while(state.pending.length){
 const job=state.pending[0];
 const key=job.categoryId+'-'+job.page;
 const pagePath=folder+'/'+key+'.json';
 let payload:any;
 // A completed response survives interruption between storing it and the cursor.
 try{payload=JSON.parse(await readFile(pagePath,'utf8'))}catch{payload=await fetchPage(job);payload.fetched_at=new Date().toISOString();await writeFile(pagePath+'.tmp',JSON.stringify(payload));await rename(pagePath+'.tmp',pagePath)}
 if(job.page===1){
  for(let page=2;page<=Math.min(payload.data.last_page,Math.ceil(plan.activeCounts[job.categoryId]/24));page++){
   if(wanted({...job,page})&&!state.pending.some(j=>j.categoryId===job.categoryId&&j.page===page)&&!state.completed.includes(job.categoryId+'-'+page))state.pending.push({...job,page});
  }
 }
 state.completed.push(key);state.pending.shift();await checkpoint();
 console.log(JSON.stringify({category:job.category,page:job.page,records:payload.data.results.length,pending:state.pending.length,creditsReserved:state.creditsReserved}));
}
await lock.close();await unlink(lockPath);
console.log('DNS API collection complete. Validate all category totals before importing into the site.');
