import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {saveSweepReport,readSweepHistory,readPublicSweepReport} from '../lib/price-report-store.ts';import {notifyPriceProblem,missedScheduledRuns} from '../lib/price-alerts.ts';import {isInCurrentSweepWindow} from '../lib/price-update-policy.ts';
import type {SweepReport} from '../lib/hourly-prices.ts';
test('пропуски считаются по одному суточному слоту 03:00 UTC', () => {
  const last = '2026-11-01T03:01Z';
  assert.equal(missedScheduledRuns(last,Date.parse('2026-11-02T15:01Z')),0);
  assert.equal(missedScheduledRuns(last,Date.parse('2026-11-04T02:59Z')),1);
  assert.equal(missedScheduledRuns(last,Date.parse('2026-11-04T03:00Z')),2);
});
test('задержавшийся резерв узнаёт утренний успех до следующего суточного окна', () => {
  const morning = Date.parse('2026-11-09T03:15Z');
  assert.equal(isInCurrentSweepWindow(morning,Date.parse('2026-11-09T20:30Z')),true);
  assert.equal(isInCurrentSweepWindow(morning,Date.parse('2026-11-10T02:59Z')),true);
  assert.equal(isInCurrentSweepWindow(morning,Date.parse('2026-11-10T03:00Z')),false);
  assert.equal(isInCurrentSweepWindow(NaN,morning),false);
});
test('история ограничена 30 циклами, неуспех не подменяет последний успех; Telegram необязателен',async()=>{const base=createRequire(import.meta.url);const {Miniflare}=createRequire(base.resolve('wrangler/package.json'))('miniflare');const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response()}}',d1Databases:['DB']});try{const db=await mf.getD1Database('DB') as D1Database;await db.prepare('CREATE TABLE source_health(store TEXT PRIMARY KEY,checked_at TEXT NOT NULL,blocked_until TEXT,error TEXT)').run();let lastSuccess='';for(let i=0;i<35;i++){const checkedAt=new Date(Date.parse('2026-10-01')+i*86400000).toISOString();const report:SweepReport={checkedAt,finishedAt:checkedAt,cycleId:String(i),cycleCompleted:i<34,status:i<34?'partial':'failed',attempted:10,updated:i<34?5:0,skipped:5,categories:{},message:'не публиковать причину'};await saveSweepReport(db,report);if(i<34)lastSuccess=checkedAt}assert.equal((await readSweepHistory(db)).length,30);assert.equal((await readPublicSweepReport(db))?.lastSuccessfulAt,lastSuccess);let calls=0;await notifyPriceProblem(db,{},'Ошибка',async()=>{calls++;return new Response()});assert.equal(calls,0);const config={TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_CHAT_ID:'456'};await notifyPriceProblem(db,config,'Ошибка',async()=>{calls++;return new Response()});await notifyPriceProblem(db,config,'Ошибка',async()=>{calls++;return new Response()});assert.equal(calls,1)}finally{await mf.dispose()}});
