import {readFile,writeFile} from 'node:fs/promises';
import {fetchHtml,parseOffer,clean} from '../lib/providers.mts';
import type {CatalogData,Product} from '../lib/catalog-types';
const data:CatalogData=JSON.parse(await readFile('data/catalog.json','utf8'));
for(const p of data.products){p.mpn=p.mpn.replace(/\s+/g,'');p.name=p.name.replace(/-\s+/g,'-').replace(/\/\s+/g,'/').replace(/,\s*$/,'');if(p.category==='cpu'&&/Intel/i.test(p.brand))delete p.specs.cores}
const links=[
 {mpn:'CM8071504821014',url:'https://www.kns.ru/product/processor-intel-core-i5-14600kf-oem/'},
 {mpn:'CM8071504820722',url:'https://www.kns.ru/product/processor-intel-core-i7-14700kf-oem/'},
 {mpn:'CM8071504650609',url:'https://www.kns.ru/product/processor-intel-core-i5-12400f-oem/'},
 {mpn:'100-000000597',url:'https://www.kns.ru/product/processor-amd-ryzen-5-7500f-oem/'},
 {mpn:'100-000000592',url:'https://www.kns.ru/product/processor-amd-ryzen-7-7700-oem/'},
];
let count=0;
for(const link of links){const product=data.products.find(p=>p.mpn===link.mpn);if(!product){console.log('No matching catalog MPN',link.mpn);continue}try{const html=await fetchHtml(link.url);if(!html.includes(link.mpn))throw new Error('MPN не подтверждён на странице');const offer=parseOffer(html,'KNS',link.url);product.offers=product.offers.filter(o=>o.store!=='KNS');product.offers.push(offer);count++;console.log(product.name,offer.price)}catch(e){console.log('KNS',product.name,String(e))}}
data.sources[1]={name:'KNS',status:count?'ok':'unavailable',note:`${count} дополнительных предложений CPU. Совпадение по артикулу производителя (MPN), а не по похожему названию. Без клубных цен.`};
await writeFile('data/catalog.json',JSON.stringify(data,null,2));console.log('ENRICHED',count);
