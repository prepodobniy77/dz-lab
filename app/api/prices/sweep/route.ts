import {readPublicSweepReport} from '../../../../lib/price-report-store';
import {verifyPriceJobBearer} from '../../../../lib/price-job-access';
import {sweepErrorStatus,SweepIntervalError} from '../../../../lib/price-job-errors';
import {env} from 'cloudflare:workers';
import {runPriceSweep} from '../../../../lib/price-sweep';
import {database} from '../../../../lib/catalog-server';
export async function GET(){try{return Response.json({report:await readPublicSweepReport(database())},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Состояние проверки недоступно'},{status:503})}}
export async function POST(request:Request){try{
 const config=env as unknown as Record<string,string|undefined>;
 if(!await verifyPriceJobBearer(request.headers.get('authorization')||'',config.PRICE_JOB_TOKEN))return Response.json({error:'Доступ запрещён'},{status:401});
 const result=await runPriceSweep(request.headers.get('x-dz-price-trigger')==='github'?'github':'manual');return Response.json(result,{status:result.report.status==='blocked'||result.report.status==='failed'?503:200});
}catch(error){const status=sweepErrorStatus(error);return Response.json({error:status===429?'Обновление уже запускалось. Дождись окончания защитного интервала.':'Сервер обновления недоступен.',...(error instanceof SweepIntervalError?{retryAfter:error.retryAfter}:{})},{status,headers:error instanceof SweepIntervalError?{'Retry-After':String(error.retryAfter)}:undefined})}}
