import {env} from 'cloudflare:workers';
import {database} from '../../../../lib/catalog-server';
import {canAccessPriceJob} from '../../../../lib/price-job-access';
import {readSweepReport,readSweepHistory,readPublicSweepReport} from '../../../../lib/price-report-store';
import {missedScheduledRuns,notifyPriceProblem} from '../../../../lib/price-alerts';
export async function GET(request:Request){const config=env as unknown as Record<string,string|undefined>;if(!await canAccessPriceJob(config,request.headers))return Response.json({error:'Нужен доступ владельца'},{status:401});try{const db=database();const report=await readSweepReport(db),summary=await readPublicSweepReport(db);if(missedScheduledRuns(report?.finishedAt||report?.checkedAt)>=2)await notifyPriceProblem(db,config,'Пропущены как минимум два запуска по расписанию. Проверь обновитель.');return Response.json({report,history:await readSweepHistory(db),lastSuccessfulAt:summary?.lastSuccessfulAt||null},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Отчёт недоступен'},{status:503})}}
