import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {dnsProvider} from '../lib/providers/dns.ts';
import {delectProvider} from '../lib/providers/delect.ts';
import {xcomProvider} from '../lib/providers/xcom.ts';
import {priceReliability} from '../lib/price-freshness.ts';
import {bestOffer} from '../lib/catalog.ts';
import {summarizeSources} from '../lib/source-status.ts';
import {sourceIsDue,sourceIntervalHours} from '../lib/source-policy.ts';
import {notifyStaleSources} from '../lib/source-monitor.ts';
import {offerWriteStatements} from '../lib/offer-storage.ts';
import {prepareSnapshotReviews,repeatedJump} from '../lib/snapshot-reviews.ts';
import {indexXcomProducts} from '../lib/price-cycle-data.ts';
import type {Product,Offer} from '../lib/catalog-types';
const now=Date.parse('2026-11-12T15:00:00Z');
const date=new Date(now).toISOString();
const offer=(hours=0,price=1000):Offer=>({store:'XCOM',url:'https://www.xcom-shop.ru/test_1.html',
  price,status:'ok',availability:'in-stock',checkedAt:new Date(now-hours*3600000).toISOString()});
const product:Product={id:'xcom-1',name:'Same name',brand:'',mpn:'PART-1',category:'cpu',specs:{},description:'',image:'',offers:[offer(48)]};
async function database(){
  const require=createRequire(import.meta.url);
  const {Miniflare}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response()}}',d1Databases:['DB']});
  const db=await mf.getD1Database('DB') as D1Database;
  for(const file of readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort()){
    await db.batch(readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  }
  return {db,dispose:()=>mf.dispose()};
}

test('границы 12/36/72 часов, неизвестная и будущая дата, отсутствие лучшей цены',()=>{
  for(const [hours,label] of [[12,'Актуально'],[12.001,'Проверено вчера'],[36,'Проверено вчера'],[36.001,'Могла устареть'],[72,'Могла устареть'],[72.001,'Цена устарела']] as const)
    assert.equal(priceReliability(offer(hours),now),label);
  assert.equal(priceReliability({...offer(),checkedAt:'invalid'},now),'Нет данных');
  assert.equal(bestOffer({...product,offers:[offer(-1),offer(73)]},now),undefined);
  assert.equal(bestOffer({...product,offers:[offer(72)]},now)?.price,1000);
});
test('DNS пропускает без URL; даты из фида/Last-Modified, валюта и происхождение сохраняются',async()=>{
  let calls=0;
  const request:typeof fetch=async()=>{calls++;return new Response('mpn;price;date\nPART-1;1000;'+date)};
  assert.equal(await dnsProvider.fetchOffers({products:[],config:{},now,fetch:request}),null);
  assert.equal(calls,0);
  const batch=await dnsProvider.fetchOffers({products:[],config:{DNS_FEED_URL:'https://feed.example/prices'},now,fetch:request});
  assert.equal(batch?.source,'feed');assert.equal(batch?.exportedAt,date);assert.equal(batch?.currency,'RUB');assert.equal(batch?.region,'Москва');
  assert.equal(batch?.rows?.[0].price,1000);
  assert.equal((await dnsProvider.fetchOffers({products:[],config:{},now,input:{text:'mpn;price\nPART-1;1000',lastModified:date}}))?.exportedAt,date);
  await assert.rejects(dnsProvider.fetchOffers({products:[],config:{},now,input:{text:'mpn;price\nPART-1;1000'}}),/даты/);
  await assert.rejects(dnsProvider.fetchOffers({products:[],config:{},now,input:{text:'mpn;price;date\nPART-1;1000;2026-11-10T00:00:00Z'}}),/устарел/);
});
test('Delect проверяет охват отдельно от XCOM и требует явный первый импорт',async()=>{
  const config={DELECT_API_KEY:'test-only',DELECT_DISTRIBUTOR:'test'};
  const request:typeof fetch=async()=>new Response(JSON.stringify({offer_id:1,part_number:'PART-1',distributor:'test',price_rub:1000,stock:1,updated_at:date})+'\n'+JSON.stringify({_eof:true,count:1}));
  await assert.rejects(delectProvider.fetchOffers({products:[product],config,now,fetch:request}),/BOOTSTRAP/);
  const batch=await delectProvider.fetchOffers({products:[product],config:{...config,DELECT_BOOTSTRAP:'1'},now,fetch:request});
  assert.equal(batch?.offers[0].offer.source,'api');assert.equal(batch?.offers[0].offer.checkedAt,date);
  const products=Array.from({length:5},(_,i)=>({...product,id:'p'+i,mpn:'PART-'+(i+1),offers:[{...offer(24),store:'DELECT' as const}]}));
  await assert.rejects(delectProvider.fetchOffers({products,config,now,fetch:request}),/80%/);
});
test('XCOM принимает только точную идентичность и останавливается на антибот-странице',async()=>{
  const reader=async()=>'<div class="catalog_item item" data-id="1" data-price="1200"><a class="catalog_item__name" href="'+product.offers[0].url+'" title="Same name">Same name</a><span data-level="1"></span></div>';
  const batch=await xcomProvider.fetchOffers({products:[product],config:{},now,snapshot:{url:product.offers[0].url,category:'cpu',read:reader}});
  assert.equal(batch?.offers[0].productId,product.id);assert.equal(batch?.offers[0].offer.source,'snapshot');
  await assert.rejects(xcomProvider.fetchOffers({products:[product],config:{},now,snapshot:{url:product.offers[0].url,read:async()=>'verify you are human'}}),/403/);
  const match=indexXcomProducts([product,{...product,id:'ambiguous'}]);
  assert.equal(match({...product,id:'unknown',offers:[{...offer(),url:'https://www.xcom-shop.ru/unknown.html'}]}),undefined);
});
test('отчёт не омолаживает старую цену по времени загрузки и не скрывает самый старый товар',()=>{
  const products=[product,{...product,id:'older',offers:[offer(80)]}];
  const status=summarizeSources(products,[{productId:product.id,offer:offer(2)}],{}, {XCOM:date},now);
  const xcom=status.find(s=>s.store==='XCOM')!;
  assert.equal(xcom.oldestPriceAgeHours,80);assert.equal(xcom.overdue,false);assert.equal(xcom.offers,2);
  assert.equal(summarizeSources(products,[],{}, {XCOM:date},now).find(s=>s.store==='XCOM')?.overdue,true);
  assert.equal(status.find(s=>s.store==='DNS')?.configured,false);
  assert.equal(status.find(s=>s.store==='DNS')?.oldestPriceAt,null);
  assert.equal(sourceIsDue('XCOM',{},new Date(now-12*3600000).toISOString(),now),true);
  assert.equal(sourceIsDue('XCOM',{},new Date(now-6*3600000).toISOString(),now),false);
  assert.throws(()=>sourceIntervalHours('DNS',{PRICE_DNS_INTERVAL_HOURS:'24'}));
});
test('D1: новая проверка той же цены меняет дату без истории; повтор и старый импорт ничего не меняют',async()=>{
  const {db,dispose}=await database();
  try{
    const write=async(o:Offer)=>db.batch(offerWriteStatements(db,[{productId:product.id,offer:o}]));
    await write(offer(2));await write(offer(1));await write(offer(1));await write(offer(3,900));
    const stored=await db.prepare('SELECT data FROM price_offers WHERE key=?').bind(product.id+':XCOM').first<{data:string}>();
    assert.equal(JSON.parse(stored!.data).checkedAt,offer(1).checkedAt);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM price_history').first<{n:number}>())?.n,1);
    await write(offer(0,1100));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM price_history').first<{n:number}>())?.n,2);
  }finally{await dispose()}
});
test('скачок подтверждается двумя последовательными циклами; повтор, пропуск и семь дней не подтверждают',async()=>{
  const candidate={productId:product.id,offer:offer(0,1600),review:true};
  const pending={...candidate,offer:offer(12,1590),cycleId:'first',firstAt:offer(12).checkedAt};
  assert.equal(repeatedJump(candidate,pending,'first','second',now),true);
  assert.equal(repeatedJump(candidate,pending,'first','first',now),false);
  assert.equal(repeatedJump(candidate,pending,'other','second',now),false);
  assert.equal(repeatedJump(candidate,{...pending,firstAt:offer(7*24).checkedAt},'first','second',now),false);
  const {db,dispose}=await database();
  try{
    const first=await prepareSnapshotReviews(db,[{...candidate,offer:pending.offer}],'first',now-12*3600000);
    assert.equal(first.review.length,1);await db.batch(first.statements);
    await db.prepare("INSERT INTO source_health(store,checked_at,error) VALUES('PRICE_SOURCE_CYCLE:XCOM',?,?)")
      .bind(pending.offer.checkedAt,JSON.stringify({cycleId:'first'})).run();
    const second=await prepareSnapshotReviews(db,[candidate],'second',now);
    assert.equal(second.published.length,1);assert.equal(second.review.length,0);
    // No per-offer DELETE storm: publication is bounded independently of catalogue size.
    assert.ok(second.statements.length<=3);
  }finally{await dispose()}
});
test('уведомления опциональны, по источнику и не чаще суток; неподключённые магазины не рассылаются',async()=>{
  const {db,dispose}=await database();let calls=0;
  const request:typeof fetch=async()=>{calls++;return new Response('{}')};
  try{
    const status=summarizeSources([product],[],{}, {},now);
    await notifyStaleSources(db,status,{},request,now);assert.equal(calls,0);
    const config={TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_CHAT_ID:'456'};
    await notifyStaleSources(db,status,config,request,now);
    await notifyStaleSources(db,status,config,request,now+12*3600000);assert.equal(calls,1);
    await notifyStaleSources(db,status,config,request,now+24*3600000);assert.equal(calls,2);
  }finally{await dispose()}
});
