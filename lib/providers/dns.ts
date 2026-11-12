import {downloadFeed} from '../feed-download.ts';
import {indexFeedCatalog,parseRetailFeed,requireFreshFeed} from '../retail-feed.ts';
import {offerMetadata,type PriceProvider,type OfferBatch} from './types.ts';

/** DNS has no HTML fallback. An absent approved feed is a silent skip. */
export const dnsProvider: PriceProvider = {
  store:'DNS', source:'feed',
  async fetchOffers(context) {
    const {config} = context;
    if (!context.input && !config.DNS_FEED_URL) return null;
    const input = context.input ?? await downloadFeed(config.DNS_FEED_URL!,config.DNS_FEED_URL,
      config.DNS_FEED_TOKEN,context.fetch);
    const feed = parseRetailFeed(input.text,'date' in input ? input.date : undefined,
      context.now ?? Date.now(),input.lastModified);
    requireFreshFeed(feed.checkedAt,config.FEED_MAX_AGE_HOURS,context.now ?? Date.now());
    const batch: OfferBatch = {store:'DNS',source:'feed',exportedAt:feed.checkedAt,
      region:'Москва',currency:'RUB',offers:[],rows:feed.rows};
    const index = indexFeedCatalog(context.products,'DNS');
    batch.offers = feed.rows.flatMap(row => {
      const match = index.match(row);
      return match ? [{productId:match.product.id,offer:{...match.offer,price:row.price,
        availability:row.availability,checkedAt:feed.checkedAt,status:'ok' as const,
        transport:'feed' as const,...offerMetadata(batch)}}] : [];
    });
    return batch;
  },
};
