import {isAllowedStoreUrl,type StoreId} from './stores.ts';
import {isSodimm} from './catalog-scope.ts';
import type {Category,Product,Specs,Offer} from './catalog-types';
export const CATALOG_URLS:Record<Category,string> = Object.fromEntries(Object.entries({cpu:'protsessory',motherboard:'materinskie_platy',gpu:'videokarty',ram:'operativnaya_pamyat',ssd:'ssd_nakopiteli',psu:'bloki_pitaniya_dlya_pk',cooler:'ohlazhdenie_kompyutera/vozdyshnye_kylery_dlya_protsessorov',case:'korpysa',hdd:'zhestkie_diski',aio:'ohlazhdenie_kompyutera/sistemy_zhidkostnogo_ohlazhdeniya'}).map(([k,v])=>[k,`https://www.xcom-shop.ru/catalog/komplektyyuschie_dlya_pk_i_noytbykov/${v}/`])) as Record<Category,string>;
export function decode(s:string){return s.replace(/&quot;/g,'"').replace(/&#039;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;|&#160;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
export function clean(s:string){return decode(s.replace(/<wbr\s*\/?\s*>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function attr(s:string,key:string){return decode(s.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1]||'')}
function meta(s:string,key:string){const tags=s.match(/<(?:meta|link)\b[^>]*>/gi)||[];return tags.find(t=>attr(t,'itemprop')===key)||''}
export function readSpecs(name:string,description:string,category:Category):Specs{
 const text=name+' '+description;const result:Specs={};
 const socket=text.match(/\b(AM[45]|LGA\s?(?:1700|1851|1200))\b/i)?.[1]?.toUpperCase().replace(/\s/g,'');if(socket)result.socket=socket;
 if(category==='cooler'||category==='aio')result.sockets=Array.from(new Set([...text.matchAll(/\b(AM[45]|LGA\s?(?:1700|1851|1200))\b/gi)].map(m=>m[1].toUpperCase().replace(/\s/g,''))));
 const memory=text.match(/\bDDR([45])\b/i)?.[1];if(memory)result.memory='DDR'+memory;
 if(category==='motherboard'&&!result.memory&&/\b(?:D4|DDR4)\b/i.test(name))result.memory='DDR4';
 const ff=text.match(/\b(mATX|micro[- ]?ATX|Mini[- ]?ITX|E[- ]?ATX|ATX)\b/i)?.[1];if(ff)result.formFactor=/micro|matx/i.test(ff)?'mATX':/mini/i.test(ff)?'ITX':/e-atx/i.test(ff)?'E-ATX':'ATX';
 const watts=text.match(/(?:Мощность(?:\s+блока\s+питания)?\s*:?\s*|TDP\s*:?\s*)(\d+)\s*Вт/i)?.[1];if(watts)result.watts=Number(watts);
 if(category==='psu'&&!result.watts){const w=name.match(/\b(\d{3,4})\s*(?:W|Вт)\b/i)?.[1];if(w)result.watts=Number(w)}
 if(category==='ram'){const n=name.match(/(?:DDR[345]\s+)?(\d+)\s*ГБ/i)?.[1];if(n)result.capacity=Number(n);result.moduleType=/SO[- ]?DIMM|SODIMM/i.test(text)?'SODIMM':/RDIMM|Registered/i.test(text)?'RDIMM':/DIMM|UDIMM/i.test(text)?'UDIMM':undefined}
 if(category==='ssd'||category==='hdd'){const n=name.match(/(\d+(?:[.,]\d+)?)\s*(ГБ|ТБ|TB|GB)/i);if(n)result.capacity=Number(n[1].replace(',','.'))*(/ТБ|TB/i.test(n[2])?1000:1);result.interface=/SAS/i.test(text)?'SAS':/NVMe|PCI[e-]/i.test(text)?'NVMe':/SATA/i.test(text)?'SATA':undefined}
 if(category==='aio'){const size=name.match(/(120|140|240|280|360|420)(?!\d)/)||description.match(/(?:Размер радиатора|Монтажный размер радиатора)[^;:]*:\s*(120|140|240|280|360|420)/i);if(size)result.radiatorSize=Number(size[1]);}

 const cores=text.match(/Кол-во ядер\s*:\s*(\d+)/i)?.[1];if(cores&&!/Intel/i.test(name))result.cores=Number(cores);
 const gl=text.match(/Длина видеокарты\s*[,м]*\s*:\s*(\d+)/i)?.[1];if(gl)result.gpuLength=Number(gl);
 const mg=text.match(/Максимальная длина видеокарты\s*[,м]*\s*:\s*(\d+)/i)?.[1];if(mg)result.maxGpuLength=Number(mg);
 const ch=text.match(/Высота(?:\s+кулера)?\s*[,м]*\s*:\s*(\d+)/i)?.[1];if(ch&&category==='cooler')result.coolerHeight=Number(ch);
 const mh=text.match(/Максимальная высота кулера\s*[,м]*\s*:\s*(\d+)/i)?.[1];if(mh)result.maxCoolerHeight=Number(mh);
 return result;
}
export function parseXcomCatalog(html:string,category:Category,checkedAt=new Date().toISOString()):Product[]{
 const blocks=html.split(/(?=<div\s+class="catalog_item\s)/i).filter(block=>/^<div\s+class="catalog_item\s/i.test(block));const result:Product[]=[];
 for(const block of blocks){
  const tag=block.slice(0,block.indexOf('>')+1);const id=attr(tag,'data-id');const nameTag=block.match(/<a\s+[^>]*class="catalog_item__name[^>]*>[\s\S]*?<\/a>/i)?.[0];if(!id||!nameTag)continue;
  const fullName=attr(nameTag,'title')||clean(nameTag);const url=new URL(attr(nameTag,'href'),'https://www.xcom-shop.ru').href;
  const rawPrice=Number(attr(tag,'data-price'));const price=Number.isFinite(rawPrice)&&rawPrice>0?rawPrice:null;
  const stockLevel=Number(block.match(/data-level="(\d+)"/)?.[1]);const availability=stockLevel;
  const description=[...block.matchAll(/<div\s+class="catalog_item__description-item"[^>]*>([\s\S]*?)<\/div>/gi)].map(m=>clean(m[1])).join(' ');
  const imageTag=block.match(/<img\s+[^>]*class="catalog_item__image[^>]*>/i)?.[0]||'';
  const mpn=fullName.match(/\[([^\]]+)\]\s*$/)?.[1]||'';
  const name=fullName.replace(/\s*\[[^\]]+\]\s*$/,'').replace(/^(Процессор|Материнская плата|Видеокарта|Оперативная память|SSD накопитель|Блок питания|Кулер|Корпус)\s+/i,'').replace(/,\s*(?:AM[45]|LGA\d+)(?:,.*)?$/,'');
  if(!name||url.includes('#')||isSodimm({category,name:fullName,description}))continue;
  result.push({id:'xcom-'+id,category,name,brand:attr(tag,'data-vendor'),mpn,image:attr(imageTag,'src'),specs:readSpecs(fullName,description,category),description,offers:[{store:'XCOM',url,price,availability:availability>0?'in-stock':Number.isFinite(stockLevel)?'out-of-stock':'unknown',checkedAt,status:price?'ok':'error',...(!price?{error:'Цена отсутствует в разметке'}:{})}]});
 }
 return result;
}
function elementBlock(html:string,start:number){const fragment=html.slice(start);const tag=fragment.match(/^<([a-z0-9]+)/i)?.[1];if(!tag)throw new Error('Некорректная разметка');let depth=0;const pattern=new RegExp('<\\/?'+tag+'\\b[^>]*>','gi');for(const token of fragment.matchAll(pattern)){if(token[0].startsWith('</'))depth--;else if(!token[0].endsWith('/>'))depth++;if(depth===0)return fragment.slice(0,token.index!+token[0].length)}throw new Error('Незакрытый блок предложения')}
export function parseOffer(html:string,store:StoreId,url:string,checkedAt=new Date().toISOString()):Offer{
 // Product microdata only. Do not pick a recommendation, bonus balance or credit payment.
 if(store==='COMPDAY')return parseCompdayOffer(html,url,checkedAt);
 const structured=primaryJsonLdProduct(html);
 if(structured){const item=structured as Record<string,unknown>;const offers=item.offers;if(!offers)throw new Error('Предложение основного товара не найдено');const candidates=Array.isArray(offers)?offers:[offers];const offer=candidates.find((v:Record<string,unknown>)=>v['@type']==='Offer'||v.price!==undefined);if(!offer)throw new Error('Цена основного товара не найдена');return normalizeOffer(offer,store,url,checkedAt)}
 const start=html.search(/<[^>]+itemtype=["'][^"']*schema\.org\/Product["']/i);if(start<0)throw new Error('Разметка товара не найдена');
 const scope=elementBlock(html,start);const offerStart=scope.search(/<[^>]+item(?:prop|type)=["'](?:offers|[^"']*schema\.org\/Offer)["']/i);if(offerStart<0)throw new Error('Предложение товара не найдено');
 const offer=elementBlock(scope,offerStart);const currency=attr(meta(offer,'priceCurrency'),'content');if(currency!=='RUB')throw new Error('Валюта цены не RUB');
 const raw=attr(meta(offer,'price'),'content');const value=Number(raw.replace(/\s/g,'').replace(',','.'));if(!raw||!Number.isFinite(value)||value<100||value>2000000)throw new Error('Цена отсутствует или не распознана');
 const stock=attr(meta(offer,'availability'),'content');return{store,url,price:value,availability:/InStock$/i.test(stock)?'in-stock':/OutOfStock|Discontinued|SoldOut$/i.test(stock)?'out-of-stock':'unknown',checkedAt,status:'ok'};
}
export async function fetchHtml(url:string,timeoutMs=18000){
 if(!isAllowedStoreUrl(url))throw new Error('Источник не разрешён');
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(18000,timeoutMs))),headers:{'Accept':'text/html','User-Agent':'DZLAB-Catalog/1.0 (price-check; +https://dz-lab-performance-dima.ardentglade35.chatgpt.site)'}});
 if(!response.ok)throw new Error(`Магазин вернул HTTP ${response.status}`);
 const size=Number(response.headers.get('content-length'));if(size>5000000)throw new Error('Ответ магазина слишком большой');const buffer=await response.arrayBuffer();const charset=/windows-1251|cp1251/i.test(response.headers.get('content-type')||'')?'windows-1251':'utf-8';const html=new TextDecoder(charset).decode(buffer);if(html.length>5000000)throw new Error('Ответ магазина слишком большой');return html;
}

export function parseDetails(html:string,product:Product){
 const attributes:Record<string,string>={};
 for(const m of html.matchAll(/<li class="card-tabs-props-list-item"[\s\S]*?<\/li>/gi)){const block=m[0];const label=clean(block.match(/class="card-tabs-props-list-item__label"[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');const value=clean(block.match(/class="card-tabs-props-list-item__value"[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');if(label&&value)attributes[label]=value}
 const text=Object.entries(attributes).map(([k,v])=>k+': '+v).join('; ');const specs={...product.specs,...readSpecs(product.name,text,product.category)};
 const numeric=(key:string)=>{const v=Number.parseFloat((attributes[key]||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(v)?v:undefined};
 if(product.category==='aio'){const size=numeric('Монтажный размер радиатора');if(size&&[120,140,240,280,360,420].includes(size))specs.radiatorSize=size;}
 if(product.category==='hdd'){const capacity=attributes['Объем накопителя']?.match(/(\d+(?:[.,]\d+)?)\s*(ТБ|ГБ|TB|GB)/i);if(capacity)specs.capacity=Number(capacity[1].replace(',','.'))*(/ТБ|TB/i.test(capacity[2])?1000:1);specs.formFactor=attributes['Форм-фактор']||specs.formFactor;}
 if(product.category==='cpu'){specs.cores=numeric('Общее количество ядер')||specs.cores;const types=Array.from(new Set((attributes['Тип памяти']||'').match(/DDR[45]/g)||[]));if(types.length)specs.memory=types.join(' / ')}
 if(product.category==='ssd'){const connection=attributes['Интерфейс']||'';if(/SATA/i.test(connection))specs.interface='SATA';else if(/PCI|NVMe/i.test(connection))specs.interface='NVMe';else if(attributes['Поддержка NVMe']==='Нет')specs.interface=undefined;}
 if(product.category==='ram'){const format=attributes['Форм-фактор']||'';specs.moduleType=/^UDIMM|^DIMM$/i.test(format)?'UDIMM':/SODIMM|SO-DIMM/i.test(format)?'SODIMM':/RDIMM/i.test(format)?'RDIMM':product.specs.moduleType;}
 if(product.category==='gpu'){specs.gpuLength=numeric('Длина видеокарты');specs.recommendedPsu=numeric('Рекомендуемый блок питания');specs.watts=numeric('Потребляемая мощность')}
 if(product.category==='motherboard'&&/^DDR[45]$/.test(attributes['Тип поддерживаемой памяти']||''))specs.memory=attributes['Тип поддерживаемой памяти'];
 if(product.category==='case'){specs.maxGpuLength=numeric('Максимальная длина карт расширения')||specs.maxGpuLength;const supported=attributes['Поддерживаемые форм-факторы материнских плат']||'';specs.supportedFormFactors=Array.from(new Set([...supported.matchAll(/\b(mATX|micro[- ]?ATX|Mini[- ]?ITX|E[- ]?ATX|ATX)\b/gi)].map(m=>/micro|matx/i.test(m[1])?'mATX':/mini/i.test(m[1])?'ITX':/e[- ]?atx/i.test(m[1])?'E-ATX':'ATX')))}
 return{attributes,specs};
}

export function primaryJsonLdProduct(html:string):Record<string,any>|null{
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const parsed=JSON.parse(m[1]);const nodes=Array.isArray(parsed)?parsed:parsed['@graph']||[parsed];for(const node of nodes){const type=node?.['@type'];if(type==='Product'||Array.isArray(type)&&type.includes('Product'))return node}}catch{}
 }
 return null;
}
export function normalizeOffer(v:Record<string,any>,store:StoreId,url:string,checkedAt=new Date().toISOString()):Offer{
 if(v.priceCurrency!=='RUB')throw new Error('Валюта цены не RUB');const raw=v.price;const price=typeof raw==='number'?raw:Number(String(raw??'').replace(/\s/g,'').replace(',','.'));if(raw==null||raw===''||!Number.isFinite(price)||price<100||price>2000000)throw new Error('Цена отсутствует или не распознана');const availability=String(v.availability||'');return{store,url,price,checkedAt,status:'ok',availability:/InStock$/.test(availability)?'in-stock':/OutOfStock|SoldOut|Discontinued|PreOrder|BackOrder/.test(availability)?'out-of-stock':'unknown'};
}
export function parseRegardGoods(html:string):{mpn:string;name:string;url:string;price:number;availability:Offer['availability']}[]{
 const match=html.match(/<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);if(!match)throw new Error('Данные каталога Регард не найдены');const parsed=JSON.parse(match[1]);const goods=parsed.props?.initialState?.storage?.goods||{};
 return Object.values(goods).flatMap((g:any)=>g.id&&g.seo_url&&g.vendorcode&&Number(g.price)>0?[{mpn:String(g.vendorcode).trim(),name:String(g.full_title||g.title),url:`https://www.regard.ru/product/${g.id}/${g.seo_url}`,price:Number(g.price),availability:g.preorder?'out-of-stock':g.show_flag===1?'in-stock':'unknown'}]:[]);
}
export function matchesMpn(html:string,mpn:string){if(!mpn)return false;const escaped=mpn.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(?<![A-Za-z0-9])'+escaped+'(?![A-Za-z0-9])','i').test(clean(html))}
function parseCompdayOffer(html:string,url:string,checkedAt:string):Offer{
 const main=html.match(/<article\b[^>]*id="pageProductCard"[^>]*>/i)?.[0];if(!main)throw new Error('Основная карточка CompDay не найдена');const raw=attr(main,'data-price');const beforeSimilar=html.split(/id="sameCat"/i)[0];const text=clean(beforeSimilar);return{...normalizeOffer({price:raw,priceCurrency:'RUB',availability:/Нет в наличии/i.test(text)?'https://schema.org/OutOfStock':/Товар доступен|В наличии/.test(text)?'https://schema.org/InStock':''},'COMPDAY',url,checkedAt),condition:/actual cash price/.test(html)?'Цена со скидкой; условия оплаты уточни в магазине':undefined};
}
