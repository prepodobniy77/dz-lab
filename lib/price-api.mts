import type {Product,Offer} from './catalog-types';
export type ApiRow={offer_id:number;part_number:string;distributor:string;price_rub:number;stock:number|string;updated_at:string};
export class PriceApiError extends Error{status:number;constructor(message:string,status=502){super(message);this.status=status}}
export function parsePriceExport(text:string):ApiRow[]{
 const lines=text.trim().split('\n').filter(Boolean);if(!lines.length)throw new PriceApiError('API вернул пустой прайс');
 const rows:ApiRow[]=[];let end:Record<string,unknown>|undefined;
 for(let i=0;i<lines.length;i++){let value:any;try{value=JSON.parse(lines[i])}catch{throw new PriceApiError('API вернул повреждённый NDJSON')}
 if(value?._eof===true){if(i!==lines.length-1)throw new PriceApiError('Маркер конца не в конце прайса');end=value;continue}
 if(!value||typeof value!=='object')throw new PriceApiError('Некорректная строка API');rows.push(value);
 }
 if(!end||end.count!==rows.length)throw new PriceApiError('Неполный прайс API: число строк или маркер конца не совпадает');
 if(end.sample===true)throw new PriceApiError('Тестовый API-ключ отдаёт образец. Для обновления нужен полный прайс',503);
 return rows;
}
export async function fetchPriceExport(key:string,supplier:string,fetcher:typeof fetch=fetch,onStarted?:()=>Promise<void>){
 if(!key||!supplier)throw new PriceApiError('API цен не активирован: владелец должен настроить DELECT_API_KEY и DELECT_DISTRIBUTOR. Сохранённые снимки цен не обновлены.',503);
 if(!/^[\p{L}\p{N} _.-]{1,80}$/u.test(supplier))throw new PriceApiError('Некорректное имя поставщика API',503);
 let response:Response;try{response=await fetcher('https://delect.ru/api/v1/lite/export/'+encodeURIComponent(supplier),{headers:{Authorization:'Bearer '+key,Accept:'application/x-ndjson'},redirect:'manual',signal:AbortSignal.timeout(45000)})}catch{throw new PriceApiError('API цен не ответил. Снимки цен не изменены.')}
 if(!response.ok)throw new PriceApiError(response.status===403?'API отказал в доступе: проверь ключ и привязку IP сервера':response.status===429?'Лимит API. Повтори позже':'API цен вернул HTTP '+response.status,response.status===429?429:502);
 await onStarted?.();
 if(response.headers.get('x-delect-sample'))throw new PriceApiError('API вернул тестовый образец, обновление отменено',503);
 const reader=response.body?.getReader();if(!reader)throw new PriceApiError('API вернул пустой ответ');
 const decoder=new TextDecoder();let text='',bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>24*1024*1024)throw new PriceApiError('Прайс больше лимита 24 МБ. Используй серверный импорт scripts/import-api-prices.mts');text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}finally{await reader.cancel()}
 return parsePriceExport(text);
}
const normalize=(s:string)=>s.trim().toUpperCase();
export function apiOffers(products:Product[],rows:ApiRow[],supplier:string){
 const byMpn=new Map<string,ApiRow[]>();for(const row of rows){if(typeof row.part_number!=='string'||row.distributor!==supplier||typeof row.price_rub!=='number'||!Number.isFinite(row.price_rub)||row.price_rub<=0||!Number.isFinite(Date.parse(row.updated_at)))continue;const key=normalize(row.part_number);byMpn.set(key,[...(byMpn.get(key)||[]),row])}
 return products.flatMap(product=>{if(!product.mpn)return[];const matches=byMpn.get(normalize(product.mpn))||[];const stock=(r:ApiRow)=>typeof r.stock==='number'?(r.stock>0?'in-stock':'out-of-stock'):/^\s*0\s*$/.test(r.stock)?'out-of-stock':'unknown';
 const row=matches.sort((a,b)=>Number(stock(b)==='in-stock')-Number(stock(a)==='in-stock')||a.price_rub-b.price_rub)[0];if(!row)return[];
 const offer:Offer={store:'DELECT',supplier,transport:'api',url:'https://delect.ru/delect-api/',price:row.price_rub,checkedAt:row.updated_at,availability:stock(row),status:'ok',identity:'mpn',condition:`Прайс поставщика ${supplier}. Это закупочная цена, не розничное предложение магазина. Налоги, минимальный заказ и условия покупки уточняются у поставщика.`};return[{id:product.id,offer}];
 });
}
