import {readFile,writeFile} from 'node:fs/promises';
import {fetchHtml,parseDetails,parseOffer} from '../lib/providers.mts';
import type {CatalogData,Category} from '../lib/catalog-types';
const data:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
const jobs=data.products.filter(p=>process.argv.includes('--remaining')?!p.attributes:['motherboard','gpu','case','cooler'].includes(p.category));let completed=0,failed=0;
async function work(){while(jobs.length){const p=jobs.shift()!;try{const html=await fetchHtml(p.offers[0].url);const details=parseDetails(html,p);p.specs=details.specs;p.attributes=details.attributes;p.offers[0]=parseOffer(html,'XCOM',p.offers[0].url);completed++;if(completed%20===0)console.log('DETAILS',completed)}catch(e){failed++;console.log('DETAIL ERROR',p.id,String(e))}}}
await Promise.all([work(),work()]);
await writeFile('data/catalog.json',JSON.stringify(data,null,2));console.log('DETAILS DONE',completed,'failed',failed);
