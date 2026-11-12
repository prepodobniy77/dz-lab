import type {StoreId} from './stores';
import type {ProviderConfig} from './providers/types';
export const SOURCE_ALERT_HOURS = 26;
export function sourceIntervalHours(store:StoreId,config:ProviderConfig) {
  const raw = config['PRICE_'+store+'_INTERVAL_HOURS'];
  const value = raw === undefined || raw === '' ? 12 : Number(raw);
  const max = store==='DNS'||store==='DELECT' ? 12 : 168;
  if (!Number.isFinite(value) || value<1 || value>max) throw new Error(`PRICE_${store}_INTERVAL_HOURS: допустимо от 1 до ${max}.`);
  return value;
}
export function sourceIsDue(store:StoreId,config:ProviderConfig,lastSuccessfulAt?:string|null,now=Date.now()) {
  const interval = sourceIntervalHours(store,config);
  const last = Date.parse(lastSuccessfulAt ?? '');
  // A small allowance prevents seconds spent publishing from skipping the next 12 h slot.
  return !Number.isFinite(last) || last>now || now-last >= interval*3600000-5*60000;
}
