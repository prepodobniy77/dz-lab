import {xcomProvider} from './xcom.ts';
import {dnsProvider} from './dns.ts';
import {delectProvider} from './delect.ts';
export const providers = [xcomProvider,dnsProvider,delectProvider] as const;
export type {PriceProvider,ProviderContext,OfferBatch,SourceKind} from './types.ts';
