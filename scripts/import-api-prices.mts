// Run on a server authorized by your API account. Keys are environment-only.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fetchPriceExport,apiOffers} from '../lib/price-api.mts';
import type {CatalogData} from '../lib/catalog-types';
const data:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
const supplier=process.env.DELECT_DISTRIBUTOR||'';
const rows=await fetchPriceExport(process.env.DELECT_API_KEY||'',supplier);
const offers=apiOffers(data.products,rows,supplier);
if(!offers.length)throw new Error('Нет совпадений по точному MPN. Каталог не изменён.');
for(const p of data.products){p.offers=p.offers.filter(o=>o.store!=='DELECT');const match=offers.find(x=>x.id===p.id);if(match)p.offers.push(match.offer)}
data.sources=data.sources.filter(s=>s.name!=='DELECT');data.sources.push({name:'DELECT',status:'partial',note:`API Lite: ${offers.length} точных MPN. Прайс поставщика ${supplier}, не розничные цены.`,checkedAt:new Date().toISOString(),url:'https://delect.ru/delect-api/'});
await writeFile('data/catalog-api.tmp.json',JSON.stringify(data,null,2));await rename('data/catalog-api.tmp.json','data/catalog.json');console.log('API: обновлено товаров',offers.length);
