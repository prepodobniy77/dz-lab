import type {Product,Selection} from './catalog-types';
import {bestOffer,categories} from './catalog.ts';

export type RetailPc={
 store:'DNS';replaces:string;url:string;price:number;currency:'RUB';image:string;
 checkedAt:string;region:'Москва';availability:string;specs:Record<string,string>;
 sourceTitle:string;rawSnippet:string;
};
export type ReadyBuild={id:string;name:string;group:string;description:string;integratedGraphics:boolean;selection:Selection;retail?:RetailPc};
export function buildOverview(selection:Selection,products:Product[]){
 const parts=categories.flatMap(c=>{const p=products.find(p=>p.id===selection[c.id]&&p.category===c.id);return p?[p]:[]});
 const offers=parts.map(bestOffer);
 return {parts,total:offers.reduce((sum,o)=>sum+(o?.price||0),0),missing:offers.filter(o=>!o).length,unresolved:Object.keys(selection).length-parts.length,checkedAt:offers.filter(o=>!!o).map(o=>o!.checkedAt).sort()[0]};
}
/** Whole-PC retail prices must never be added to individual component prices. */
export function readyBuildOverview(build:ReadyBuild,products:Product[]){
 return build.retail?{parts:[] as Product[],total:build.retail.price,missing:0,unresolved:0,checkedAt:build.retail.checkedAt}:buildOverview(build.selection,products);
}
