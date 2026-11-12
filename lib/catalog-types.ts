import type {PublicSweepReport} from './price-status';
import type {StoreId} from './stores';
export type Category='cpu'|'motherboard'|'gpu'|'ram'|'ssd'|'psu'|'cooler'|'case'|'hdd'|'aio';
export type Specs={tdp?:number;radiatorSize?:number;radiatorSizes?:number[];socket?:string;memory?:string;formFactor?:string;supportedFormFactors?:string[];watts?:number;capacity?:number;cores?:number;gpuLength?:number;maxGpuLength?:number;coolerHeight?:number;maxCoolerHeight?:number;sockets?:string[];maxPower?:number;interface?:string;recommendedPsu?:number;moduleType?:string};
export type Offer={sku?:string;requiresReview?:boolean;discovery?:'ai-search';source?:'api'|'feed'|'snapshot';exportedAt?:string;region?:'Москва';currency?:'RUB';transport?:'api'|'feed'|'html-snapshot';supplier?:string;store:StoreId;url:string;price:number|null;availability:'in-stock'|'out-of-stock'|'unknown';checkedAt:string;status:'ok'|'error';error?:string;identity?:'mpn'|'verified-reference';lastSuccessAt?:string;condition?:string};
export type Product={priceReviewPending?:boolean;id:string;category:Category;name:string;brand:string;mpn:string;image:string;specs:Specs;description:string;attributes?:Record<string,string>;offers:Offer[]};
export type Selection=Partial<Record<Category,string>>;
export type CatalogData={priceUpdate?:PublicSweepReport|null;priceApi?:{configured:boolean;provider:string};products:Product[];importedAt:string;region:string;sources:{name:string;status:string;note:string;checkedAt?:string;url?:string}[]};
