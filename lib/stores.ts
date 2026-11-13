export const stores=[
 {id:'DELECT',label:'Delect · прайс поставщика',url:'https://delect.ru/delect-api/',hosts:['delect.ru']},
 {id:'XCOM',label:'XCOM-SHOP',url:'https://www.xcom-shop.ru/',hosts:['www.xcom-shop.ru']},
 {id:'REGARD',label:'Регард',url:'https://www.regard.ru/',hosts:['www.regard.ru']},
 {id:'DNS',label:'DNS',url:'https://www.dns-shop.ru/',hosts:['www.dns-shop.ru']},
 {id:'CITILINK',label:'Ситилинк',url:'https://www.citilink.ru/',hosts:['www.citilink.ru']},
 {id:'BIT28',label:'28bit',url:'https://28bit.ru/',hosts:['28bit.ru']},
 {id:'MVIDEO',label:'М.Видео',url:'https://www.mvideo.ru/',hosts:['www.mvideo.ru']},
] as const;
// Historical IDs remain readable in archived snapshots, never active or allowed for imports.
export const retiredStoreIds=['KNS','COMPDAY','E2E4','NIX','FCENTER','ONLINETRADE'] as const;
export type StoreId=typeof stores[number]['id']|typeof retiredStoreIds[number];
export function storeInfo(id:string){return stores.find(s=>s.id===id)}
export function isAllowedStoreUrl(value:string,expected?:StoreId){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&stores.some(s=>(!expected||s.id===expected)&&(s.hosts as readonly string[]).includes(u.hostname))}catch{return false}}
export function sourceStatusLabel(status:string){return status==='ok'?'Цены получены':status==='partial'?'Частичный охват':status==='limited'?'Доступ ограничен':status==='unavailable'?'Временно недоступен':'Цена не получена'}
