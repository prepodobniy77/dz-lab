import {clean} from './providers.mts';
import {isSodimm} from './catalog-scope.ts';
import type {Category} from './catalog-types';

const root='https://www.regard.ru';
export const regardCategories=[
 ['cpu',1001,'processory'],['motherboard',1000,'materinskie-platy'],['gpu',1013,'videokarty'],
 ['ram',1010,'operativnaya-pamyat'],['ssd',1015,'nakopiteli-ssd'],['hdd',1014,'zhestkie-diski-hdd'],
 ['psu',1225,'bloki-pitaniya'],['case',1032,'korpusa'],['cooler',5162,'kulery-dlya-processorov'],
 ['aio',1008,'zidkostnoe-oxlazdenie-szo'],
] as const;

export function regardListUrl(id:number, slug:string, page:number){
 return root+'/catalog/'+id+'/'+slug+(page===1?'':'?page='+page);
}

/** Decode the listing rendered by Regard's public Moscow catalog. */
export function parseRegardListing(html:string, category:Category, id:number, page:number, url:string){
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
  const pages=Math.max(1,Math.ceil(expected/size));
  if(pages>300)throw Error('Unexpected catalogue size');
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
  return {pages,expected,listed:list.map((row:{id:number})=>String(row.id)),items};
}
