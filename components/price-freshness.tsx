import {Clock,AlertTriangle} from 'lucide-react';
import type {Offer} from '../lib/catalog-types';
import {priceAgeHours,priceAgeLabel,priceReliability,PRICE_STALE_HOURS,PRICE_EXPIRED_HOURS} from '../lib/price-freshness';
import {sweepStatusLabel,type PublicSweepReport} from '../lib/price-status';
export function PriceFreshness({offer}:{offer:Offer|undefined}){
 const age=priceAgeHours(offer),stale=age>PRICE_STALE_HOURS;
 if(!offer||offer.status!=='ok'||offer.price===null)return <span className="price-freshness">Нет данных</span>;
 return <span className={'price-freshness '+(stale?'stale':'')} title={priceAgeLabel(offer)} suppressHydrationWarning>
  {stale?<AlertTriangle size={16} aria-hidden="true"/>:<Clock size={16} aria-hidden="true"/>}
  <span>{priceReliability(offer)}{age>PRICE_EXPIRED_HOURS?' · не участвует в лучшей цене':''}{offer.requiresReview?' · новая цена требует проверки':''}</span>
 </span>;
}
export function PriceUpdateStatus({report,snapshotDate}:{report:PublicSweepReport|null|undefined;snapshotDate:string}){const time=report?.lastSuccessfulAt;const stamp=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(time||snapshotDate));return <span>{time?`Последнее подтверждённое обновление ${stamp} МСК`:`Цены из снимков магазинов · ${stamp} МСК · Автообновление ещё не подтверждено`}{report?` · ${sweepStatusLabel[report.status]}`:''}</span>}
