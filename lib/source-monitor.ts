import {readSourceStatuses,type SourceStatus} from './source-status.ts';
import type {Product} from './catalog-types';
import type {ProviderConfig} from './providers/types';
import {stores} from './stores.ts';

export async function notifyStaleSources(db:D1Database,statuses:SourceStatus[],config:ProviderConfig,
  request:typeof fetch=fetch,now=Date.now()) {
  const token=config.TELEGRAM_BOT_TOKEN,chat=config.TELEGRAM_CHAT_ID;
  if (!token||!chat||!/^\d+:[A-Za-z0-9_-]+$/.test(token)||!/^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(chat)) return;
  for(const source of statuses.filter(s=>s.configured&&s.overdue)) {
    const key='PRICE_SOURCE_ALERT:'+source.store;
    const last=await db.prepare('SELECT checked_at FROM source_health WHERE store=?').bind(key).first<{checked_at:string}>();
    if(last&&now-Date.parse(last.checked_at)<24*3600000)continue;
    try {
      const response=await request('https://api.telegram.org/bot'+token+'/sendMessage',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:chat,text:'DZ LAB: '+stores.find(s=>s.id===source.store)!.label+
          (source.newestPriceAt?' — нет свежих подтверждённых цен больше 26 часов. Последняя дата: '+source.newestPriceAt:' — обновление цен ещё не подтверждено. Нет данных.')})});
      if(response.ok)await db.prepare(`INSERT INTO source_health(store,checked_at) VALUES(?,?)
        ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at`).bind(key,new Date(now).toISOString()).run();
      await response.body?.cancel();
    } catch {console.error('Не удалось отправить уведомление об источнике',source.store)}
  }
}
export async function monitorSources(db:D1Database,products:Product[],config:ProviderConfig) {
  const sources=await readSourceStatuses(db,products,config);
  await notifyStaleSources(db,sources,config);
  return sources;
}
