import type {Offer, Product} from './catalog-types';
import type {PriceObservation} from './price-feed';

export async function readCatalogPriceDelta(db: D1Database): Promise<PriceObservation[]> {
  const {results} = await db.prepare(
    'SELECT product_id, data FROM price_offers WHERE is_seed = 0',
  ).all<{product_id: string; data: string}>();
  return results.map(row => ({productId: row.product_id, offer: JSON.parse(row.data) as Offer}));
}

export function mergeCatalogOffers(product: Product, observations: readonly Offer[]): Product {
  const offers = [...product.offers];
  for (const offer of observations) {
    const index = offers.findIndex(current => current.store === offer.store);
    if (index < 0) offers.push(offer);
    else if (Date.parse(offer.checkedAt) > Date.parse(offers[index].checkedAt)) offers[index] = offer;
  }
  return {...product, offers};
}
