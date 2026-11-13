import type {Category, Offer, Product} from '../catalog-types';
import type {FeedRow} from '../retail-feed';
import type {StoreId} from '../stores';

export type SourceKind = 'api'|'feed'|'snapshot';
export type ProviderConfig = Record<string,string|undefined>;
export type ProviderOffer = {productId:string; offer:Offer};
export type OfferBatch = {
  store: StoreId;
  source: SourceKind;
  exportedAt: string;
  region: 'Москва';
  currency: 'RUB';
  offers: ProviderOffer[];
  /** Original normalized rows, including invalid prices, for coverage validation. */
  rows?: FeedRow[];
};
export type ProviderContext = {
  products: Product[];
  config: ProviderConfig;
  now?: number;
  fetch?: typeof fetch;
  input?: {text:string; date?:string; lastModified?:string};
  /** Only the crawler supplies this reader, after robots and rate checks. */
  snapshot?: {url:string; category?:Category; product?:Product;
    read:(url:string)=>Promise<string|null|undefined>};
};
export interface PriceProvider {
  store: StoreId;
  source: SourceKind;
  isConfigured(config:ProviderConfig): boolean;
  fetchOffers(context: ProviderContext): Promise<OfferBatch|null>;
}

export function offerMetadata(batch: Pick<OfferBatch,'source'|'exportedAt'|'region'|'currency'>) {
  return {source:batch.source,exportedAt:batch.exportedAt,region:batch.region,currency:batch.currency};
}
