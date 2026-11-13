import type {Offer} from './catalog-types';
export const PRICE_CURRENT_HOURS=12;
export const PRICE_STALE_HOURS=36;
export const PRICE_EXPIRED_HOURS=72;
export function priceAgeHours(offer:Pick<Offer,'checkedAt'>|undefined,now=Date.now()){const checked=Date.parse(offer?.checkedAt||'');return Number.isFinite(checked)?(checked>now?Infinity:(now-checked)/3600000):Infinity}
export function isConfirmedOffer(offer:Offer){return offer.status==='ok'&&typeof offer.price==='number'&&Number.isFinite(offer.price)&&offer.price>0&&offer.availability!=='out-of-stock'}
export function hasFreshPrice(offers:Offer[],now=Date.now()){return offers.some(o=>isConfirmedOffer(o)&&priceAgeHours(o,now)<=PRICE_STALE_HOURS)}
export function priceAgeLabel(offer:Offer|undefined,now=Date.now()){const age=priceAgeHours(offer,now);return !Number.isFinite(age)?'Дата проверки неизвестна':age<1?'Обновлено менее часа назад':`Обновлено ${Math.floor(age)} ч назад`}

export function priceReliability(offer:Offer|undefined,now=Date.now()){const age=priceAgeHours(offer,now);return !Number.isFinite(age)?"Нет данных":age<=PRICE_CURRENT_HOURS?"Актуально":age<=PRICE_STALE_HOURS?"Проверено вчера":age<=PRICE_EXPIRED_HOURS?"Могла устареть":"Цена устарела"}
