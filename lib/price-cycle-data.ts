import type {Product,Offer} from './catalog-types';
import {CATALOG_URLS} from './providers.mts';
export type StagedPrice={productId:string;offer:Offer;review:boolean};
export function xcomJobs(){return Array.from({length:6},(_,i)=>Object.entries(CATALOG_URLS).map(([category,base])=>({category,url:i?base+`?catalog=page-${i+1}`:base,page:i+1}))).flat()}
const part=(v:string)=>v.trim().toUpperCase();
const reference=(v:string)=>{try{const u=new URL(v);return u.origin+u.pathname}catch{return''}};
export function matchXcomProduct(incoming:Product,known:Product[]){return known.find(p=>p.category===incoming.category&&((p.id===incoming.id&&p.offers.some(o=>o.store==='XCOM'&&reference(o.url)===reference(incoming.offers[0]?.url||'')))||!!p.mpn&&!!incoming.mpn&&part(p.mpn)===part(incoming.mpn)))}
export function stagePrice(product:Product,offer:Offer):StagedPrice|null{if(offer.status!=='ok'||typeof offer.price!=='number'||!Number.isFinite(offer.price)||offer.price<=0||!Number.isFinite(Date.parse(offer.checkedAt)))return null;const old=product.offers.find(o=>o.store===offer.store&&o.status==='ok'&&o.price!==null);return{productId:product.id,offer,review:!!old?.price&&Math.abs(offer.price-old.price)/old.price>0.5}}
export function coverageAccepted(found:number,baseline:number){return baseline>0&&found>=Math.ceil(baseline*0.8)}
