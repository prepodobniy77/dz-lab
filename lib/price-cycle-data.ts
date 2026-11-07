import type {Product,Offer} from './catalog-types';
import {CATALOG_URLS} from './providers.mts';
export type StagedPrice={productId:string;offer:Offer;review:boolean};
export function xcomJobs(){return Array.from({length:6},(_,i)=>Object.entries(CATALOG_URLS).map(([category,base])=>({category,url:i?base+`?catalog=page-${i+1}`:base,page:i+1}))).flat()}
const part=(v:string)=>v.trim().toUpperCase();
const reference=(v:string)=>{try{const u=new URL(v);return u.origin+u.pathname}catch{return''}};
export function indexXcomProducts(products: Product[]) {
 const byId = new Map<string, {product: Product; index: number}>();
 const byPart = new Map<string, {product: Product; index: number}>();
 products.forEach((product, index) => {
  const entry = {product, index};
  if (product.offers.some(offer => offer.store === 'XCOM')) byId.set(product.id, entry);
  if (product.mpn) {
   const key = product.category + ':' + part(product.mpn);
   if (!byPart.has(key)) byPart.set(key, entry);
  }
 });
 return (incoming: Product) => {
  const id = byId.get(incoming.id);
  const mpn = incoming.mpn ? byPart.get(incoming.category + ':' + part(incoming.mpn)) : undefined;
  if (id && id.product.category === incoming.category && (!mpn || id.index < mpn.index) &&
      id.product.offers.some(o => o.store === 'XCOM' && reference(o.url) === reference(incoming.offers[0]?.url || ''))) {
   return id.product;
  }
  return mpn?.product;
 };
}
export function matchXcomProduct(incoming: Product, known: Product[]) {
 return indexXcomProducts(known)(incoming);
}
export function stagePrice(product:Product,offer:Offer):StagedPrice|null{if(offer.status!=='ok'||typeof offer.price!=='number'||!Number.isFinite(offer.price)||offer.price<=0||!Number.isFinite(Date.parse(offer.checkedAt)))return null;const old=product.offers.find(o=>o.store===offer.store&&o.status==='ok'&&o.price!==null);return{productId:product.id,offer,review:!!old?.price&&Math.abs(offer.price-old.price)/old.price>0.5}}
export function coverageAccepted(found:number,baseline:number){return baseline>0&&found>=Math.ceil(baseline*0.8)}
