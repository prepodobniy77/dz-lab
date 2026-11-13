import {apiOffers,fetchPriceExport,PriceApiError} from '../price-api.mts';
import {coverageAccepted} from '../price-cycle-data.ts';
import {offerMetadata,type PriceProvider,type OfferBatch} from './types.ts';

export const delectProvider: PriceProvider = {
  store:'DELECT', source:'api',
  isConfigured:config=>Boolean(config.DELECT_API_KEY&&config.DELECT_DISTRIBUTOR),
  async fetchOffers(context) {
    const {config,products} = context;
    if (!config.DELECT_API_KEY || !config.DELECT_DISTRIBUTOR) return null;
    const rows = await fetchPriceExport(config.DELECT_API_KEY,config.DELECT_DISTRIBUTOR,context.fetch);
    const now = context.now ?? Date.now();
    const mapped = apiOffers(products,rows,config.DELECT_DISTRIBUTOR).filter(({offer}) => {
      const time = Date.parse(offer.checkedAt);
      return time <= now && now-time <= 36*3600000;
    });
    const known = products.filter(p=>p.offers.some(o=>o.store==='DELECT'));
    const knownIds = new Set(known.map(p=>p.id));
    const found = new Set(mapped.filter(v=>knownIds.has(v.id)).map(v=>v.id)).size;
    if (known.length ? !coverageAccepted(found,known.length) : config.DELECT_BOOTSTRAP !== '1') {
      throw new PriceApiError(known.length?'Охват прайса Delect ниже 80%.':'Первый импорт Delect требует DELECT_BOOTSTRAP=1.');
    }
    if (!mapped.length) throw new PriceApiError('Нет подтверждённых свежих предложений Delect.');
    // Oldest row determines the age of this export; download time is never substituted.
    const exportedAt = new Date(Math.min(...mapped.map(v=>Date.parse(v.offer.checkedAt)))).toISOString();
    const batch: OfferBatch = {store:'DELECT',source:'api',exportedAt,region:'Москва',currency:'RUB',offers:[]};
    batch.offers = mapped.map(v=>({productId:v.id,offer:{...v.offer,checkedAt:new Date(v.offer.checkedAt).toISOString(),...offerMetadata({...batch,exportedAt:new Date(v.offer.checkedAt).toISOString()})}}));
    return batch;
  },
};
export default delectProvider;
