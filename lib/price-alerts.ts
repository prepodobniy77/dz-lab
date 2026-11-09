import {currentSweepWindowStart, SWEEP_DAY_MS} from './price-update-policy.ts';

export function missedScheduledRuns(lastRun: string|undefined, now = Date.now()) {
  const last = Date.parse(lastRun || '');
  if (!Number.isFinite(last)) return 0;
  // Allow the current slot to finish before counting it as missed.
  const previousSlot = currentSweepWindowStart(now)-SWEEP_DAY_MS;
  return Math.min(30,Math.max(0,Math.ceil((previousSlot-last)/SWEEP_DAY_MS)));
}

export async function notifyPriceProblem(db:D1Database,config:Record<string,string|undefined>,reason:string,fetcher:typeof fetch=fetch,now=Date.now()){
 const token=config.TELEGRAM_BOT_TOKEN,chat=config.TELEGRAM_CHAT_ID;if(!token||!chat)return;
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token)||! /^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(chat))return;
 const last=await db.prepare("SELECT checked_at FROM source_health WHERE store='PRICE_SWEEP_ALERT'").first<{checked_at:string}>();if(last&&now-Date.parse(last.checked_at)<12*3600000)return;
 try{const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:'DZ LAB: '+reason}),redirect:'manual',signal:AbortSignal.timeout(5000)});if(response.ok)await db.batch([db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SWEEP_ALERT',?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(new Date(now).toISOString(),reason)])}catch{console.error('Не удалось отправить уведомление об обновлении цен')}
}
