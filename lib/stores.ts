export const stores=[
 {id:'DELECT',label:'Delect · прайс поставщика',url:'https://delect.ru/delect-api/',hosts:['delect.ru']},
 {id:'XCOM',label:'XCOM-SHOP',url:'https://www.xcom-shop.ru/',hosts:['www.xcom-shop.ru']},
 {id:'KNS',label:'KNS',url:'https://www.kns.ru/',hosts:['www.kns.ru']},
 {id:'REGARD',label:'Регард',url:'https://www.regard.ru/',hosts:['www.regard.ru']},
 {id:'COMPDAY',label:'CompDay',url:'https://www.compday.ru/',hosts:['www.compday.ru']},
 {id:'E2E4',label:'e2e4 · Москва',url:'https://moscow.e2e4online.ru/',hosts:['moscow.e2e4online.ru']},
 {id:'DNS',label:'DNS',url:'https://www.dns-shop.ru/',hosts:['www.dns-shop.ru']},
 {id:'CITILINK',label:'Ситилинк',url:'https://www.citilink.ru/',hosts:['www.citilink.ru']},
 {id:'ONLINETRADE',label:'Онлайн Трейд',url:'https://www.onlinetrade.ru/',hosts:['www.onlinetrade.ru']},
 {id:'NIX',label:'НИКС',url:'https://www.nix.ru/',hosts:['www.nix.ru']},
 {id:'FCENTER',label:'Ф-Центр',url:'https://www.fcenter.ru/',hosts:['www.fcenter.ru']},
] as const;
export type StoreId=typeof stores[number]['id'];
export function storeInfo(id:string){return stores.find(s=>s.id===id)}
export function isAllowedStoreUrl(value:string,expected?:StoreId){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&stores.some(s=>(!expected||s.id===expected)&&(s.hosts as readonly string[]).includes(u.hostname))}catch{return false}}
export function sourceStatusLabel(status:string){return status==='ok'?'Цены получены':status==='partial'?'Частичный охват':status==='limited'?'Доступ ограничен':status==='unavailable'?'Временно недоступен':'Цена не получена'}
