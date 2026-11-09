import {SWEEP_HOUR_UTC} from './price-update-policy.ts';

const dayMs = 86_400_000;

export function missedScheduledRuns(lastRun: string|undefined, now = Date.now()) {
  const last = Date.parse(lastRun || '');
  if (!Number.isFinite(last)) return 0;
  const today = new Date(now);
  const todaySlot = Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate(),SWEEP_HOUR_UTC);
  const currentSlot = todaySlot <= now ? todaySlot : todaySlot-dayMs;
  // Allow the current slot to finish before counting it as missed.
  return Math.min(30,Math.max(0,Math.ceil((currentSlot-dayMs-last)/dayMs)));
}

export async function notifyPriceProblem(db:D1Database,config:Record<string,string|undefined>,reason:string,fetcher:typeof fetch=fetch,now=Date.now()){
 const token=config.TELEGRAM_BOT_TOKEN,chat=config.TELEGRAM_CHAT_ID;if(!token||!chat)return;
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token)||! /^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(chat))return;
 const last=await db.prepare("SELECT checked_at FROM source_health WHERE store='PRICE_SWEEP_ALERT'").first<{checked_at:string}>();if(last&&now-Date.parse(last.checked_at)<12*3600000)return;
 try{const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:'DZ LAB: '+reason}),redirect:'manual',signal:AbortSignal.timeout(5000)});if(response.ok)await db.batch([db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SWEEP_ALERT',?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").bind(new Date(now).toISOString(),reason)])}catch{console.error('Не удалось отправить уведомление об обновлении цен')}
}
