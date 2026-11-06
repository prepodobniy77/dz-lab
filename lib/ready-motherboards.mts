import type {Product} from './catalog-types.ts';
import {bestOffer} from './catalog.ts';
export type ReadyBoardChoice={buildId:string;productId:string;role:'basic'|'gaming'|'sustained';rationale:string;sourceUrls:string[];reviewedAt:string};
/** Resolve a reviewed exact board. A missing model requires review, never a cheaper fallback. */
export function readyMotherboard(buildId:string,products:Product[],plan:ReadyBoardChoice[]):Product{
 const choices=plan.filter(p=>p.buildId===buildId);
 if(choices.length!==1)throw Error('Exactly one reviewed motherboard is required for '+buildId);
 const board=products.find(p=>p.id===choices[0].productId&&p.category==='motherboard');
 if(!board||!bestOffer(board))throw Error('Reviewed motherboard unavailable for '+buildId+'; review a replacement');
 return board;
}
