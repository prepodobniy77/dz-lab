/** Normalize authenticated provider responses and public browser observations.
 * Does not fetch pages or bypass access controls. Caller must respect store rules.
 */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
const root='.sites-runtime';
const plan=JSON.parse(await readFile(root+'/reef-dns/active-plan.json','utf8'));
const sourceText=await readFile('scripts/fetch-dns-api.mts','utf8');
const sources=[...sourceText.matchAll(/\['([^']+)','([^']+)','([a-f0-9]{16})'\]/g)].map(m=>({category:m[1],title:m[2],id:m[3]}));
await mkdir(root+'/dns-normalized',{recursive:true});
const coverage=[];
for(const source of sources){
 const rows=new Map<string,any>();
 const files=(await readdir(root+'/reef-dns')).filter(f=>f.startsWith(source.id+'-')&&f.endsWith('.json'));
 for(const file of files){
  const payload=JSON.parse(await readFile(root+'/reef-dns/'+file,'utf8'));
  if(payload.ok!==true||payload.data.category_id!==source.id)throw Error('Invalid provider cache');
  for(const row of payload.data.results){
   if(row.avail_status==='out_of_stock')continue;
   rows.set(row.guid,{guid:row.guid,sku:row.code,name:row.name+' ['+row.short_specs+']',url:row.url,priceText:row.price===null?null:row.price+' ₽',availability:row.avail_status,availabilityText:'',image:row.image,attributes:row.specs||{},checkedAt:payload.fetched_at,transport:'api'});
  }
 }
 for(const file of (await readdir(root+'/dns-active-browser').catch(()=>[])).filter(f=>f.includes(source.id)&&f.endsWith('.json'))){
  const snapshot=JSON.parse(await readFile(root+'/dns-active-browser/'+file,'utf8'));
  if(snapshot.source!=='public-browser-catalog'||snapshot.region!=='Москва'||snapshot.category!==source.category)throw Error('Invalid browser source');
  for(const row of snapshot.items){
   const previous=rows.get(row.guid);
   if(!previous||(row.priceText&&Date.parse(row.checkedAt||snapshot.checkedAt)>=Date.parse(previous.checkedAt)))rows.set(row.guid,{...row,checkedAt:row.checkedAt||snapshot.checkedAt,transport:'html-snapshot'});
  }
 }
 const items=[...rows.values()];
 const expected=plan.activeCounts[source.id];
 const entry={...source,expected,loaded:items.length,priced:items.filter(r=>r.priceText).length,complete:items.length===expected};
 coverage.push(entry);
 await writeFile(root+'/dns-normalized/'+source.id+'.json',JSON.stringify({source:'validated-dns-catalog',category:source.category,region:'Москва',url:'https://www.dns-shop.ru/catalog/'+source.id+'/',title:source.title,checkedAt:new Date().toISOString(),items}));
}
await writeFile(root+'/dns-coverage.json',JSON.stringify(coverage,null,2));
console.log(JSON.stringify(coverage,null,2));
