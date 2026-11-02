import type {SweepReport} from './hourly-prices';
export type PublicSweepReport={checkedAt:string;status:SweepReport['status'];attempted:number;updated:number;lastSuccessfulAt:string|null};
export function parseSweepReport(value:string|null|undefined){try{return value?JSON.parse(value) as SweepReport:null}catch{return null}}
export function publicSweepReport(report:SweepReport|null,success:SweepReport|null):PublicSweepReport|null{if(!report)return null;return{checkedAt:report.checkedAt,status:report.status,attempted:report.attempted,updated:report.updated,lastSuccessfulAt:success?.finishedAt||success?.checkedAt||null}}
export const sweepStatusLabel={complete:'Проверка завершена',partial:'Частичное обновление',blocked:'Обновление не выполнено',failed:'Ошибка обновления'};
