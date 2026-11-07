import type {Product} from './catalog-types';
import {categories} from './catalog.ts';
import {isConfirmedOffer} from './price-freshness.ts';
// Цикл попыток нужен для справедливого обхода даже при постоянных отказах отдельных товаров.
export function oldestPriceSelection(products:Product[],limit=50,attemptedIds:readonly string[]=[]){
 const cap=Math.min(50,Math.max(10,Math.floor(limit)));const quota=Math.floor(cap/categories.length);
 const attempted=new Set(attemptedIds);const remaining=products.some(p=>!attempted.has(p.id))?products.filter(p=>!attempted.has(p.id)):products;
 const age=(p:Product)=>{const offers=p.offers.filter(isConfirmedOffer).sort((a,b)=>a.price!-b.price!);const checked=Date.parse(offers[0]?.checkedAt||'');return Number.isFinite(checked)?checked:-Infinity};
 const groups=categories.map(c=>remaining.filter(p=>p.category===c.id).sort((a,b)=>age(a)-age(b)||a.id.localeCompare(b.id)).slice(0,quota));
 return Array.from({length:quota},(_,i)=>groups.flatMap(group=>group[i]?[group[i]]:[])).flat();
}
export type SweepReport={checkedAt:string;finishedAt?:string;status:'blocked'|'failed'|'partial'|'complete';retryAfter?:number;trigger?:'manual'|'cron'|'mcp'|'github';attempted:number;updated:number;updatedOffers?:number;skipped:number;categories:Record<string,{attempted:number;updated:number}>;message:string;cycleCompleted?:boolean;cycleId?:string;done?:boolean;durationMs?:number;totalDurationMs?:number;activeDurationMs?:number;portions?:number;pendingReviews?:number;aiProducts?:number;httpRequests?:number;d1Requests?:number;aiBatches?:number;listingPages?:number};
