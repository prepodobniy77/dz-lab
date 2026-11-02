import type {SweepReport} from './hourly-prices';
import {parseSweepReport,publicSweepReport} from './price-status.ts';
import {missedScheduledRuns,notifyPriceProblem} from './price-alerts.ts';
export async function readSweepReport(db:D1Database){const row=await db.prepare("SELECT error FROM source_health WHERE store='PRICE_SWEEP'").first<{error:string}>();return parseSweepReport(row?.error)}
export async function readPublicSweepReport(db:D1Database){const rows=await db.prepare("SELECT store,error FROM source_health WHERE store IN ('PRICE_SWEEP','PRICE_SWEEP_SUCCESS')").all<{store:string;error:string}>();return publicSweepReport(parseSweepReport(rows.results.find(r=>r.store==='PRICE_SWEEP')?.error),parseSweepReport(rows.results.find(r=>r.store==='PRICE_SWEEP_SUCCESS')?.error))}
export async function readSweepHistory(db:D1Database){const rows=await db.prepare("SELECT error FROM source_health WHERE store LIKE 'PRICE_SWEEP_RUN:%' ORDER BY checked_at DESC LIMIT 30").all<{error:string}>();return rows.results.map(r=>parseSweepReport(r.error)).filter((v):v is SweepReport=>!!v)}
export async function saveSweepReport(db:D1Database,report:SweepReport,final=true,config:Record<string,string|undefined>={}){
 const previous=config.TELEGRAM_BOT_TOKEN&&config.TELEGRAM_CHAT_ID?await readSweepReport(db):null;
 const statements=[db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SWEEP',?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(report.checkedAt,JSON.stringify(report))];
 if(final){const id=report.cycleId||crypto.randomUUID();statements.push(db.prepare('INSERT INTO source_health(store,checked_at,error) VALUES(?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error').bind('PRICE_SWEEP_RUN:'+id,report.finishedAt||report.checkedAt,JSON.stringify(report)));statements.push(db.prepare("DELETE FROM source_health WHERE store LIKE 'PRICE_SWEEP_RUN:%' AND store NOT IN (SELECT store FROM source_health WHERE store LIKE 'PRICE_SWEEP_RUN:%' ORDER BY checked_at DESC LIMIT 30)"))}
 if(final&&report.cycleCompleted&&report.updated>0&&(report.status==='complete'||report.status==='partial'))statements.push(db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SWEEP_SUCCESS',?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(report.finishedAt||report.checkedAt,JSON.stringify(report)));
 await db.batch(statements);
 if(final&&(report.status==='blocked'||report.status==='failed'))await notifyPriceProblem(db,config,`Проверка цен не выполнена (${report.status}). Обновлено ${report.updated} из ${report.attempted}.`);
 else if(missedScheduledRuns(previous?.finishedAt||previous?.checkedAt)>=2)await notifyPriceProblem(db,config,'Пропущены как минимум два запуска по расписанию. Проверь обновитель.');
}
