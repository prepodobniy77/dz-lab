import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {findRouterAIPriceLinks} from '../lib/routerai-price-search.mts';
import {findPriceLinks} from '../lib/ai-price-search.mts';
import {fetchPriceExport} from '../lib/price-api.mts';
import {priceSweepFailureMessage} from '../lib/price-job-errors.ts';
import type {Product} from '../lib/catalog-types';
const product={id:'p',name:'CPU',mpn:'EXACT',offers:[]} as unknown as Product;

test('запросы провайдеров совместимы с Workers и отклоняют редиректы без перехода',async()=>{
 const base=createRequire(import.meta.url);
 const wrangler=createRequire(base.resolve('wrangler/package.json'));
 const {Miniflare}=wrangler('miniflare');
 // Используем установленную среду Workers. Внешних запросов и ключей нет.
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-05-01',script:`export default {async fetch(request){try{const {redirect}=await request.json();const outgoing=new Request('https://example.invalid',{redirect});return Response.json({redirect:outgoing.redirect})}catch(e){return Response.json({error:e.message},{status:500})}}}`});
 try{
  for(const status of [301,302,303,307,308]){
   let requests=0;
   const rejectRedirect:typeof fetch=async(_url,init)=>{
    requests++;assert.equal(init?.redirect,'manual');
    const validation=await runtime.dispatchFetch('http://runtime.test',{method:'POST',body:JSON.stringify({redirect:init?.redirect})});
    assert.equal(validation.status,200,await validation.text());
    return new Response('не использовать это тело',{status,headers:{location:'https://attacker.invalid'}});
   };
   await assert.rejects(findRouterAIPriceLinks([product],'test-key',undefined,rejectRedirect),new RegExp(`HTTP ${status}`));
   await assert.rejects(findPriceLinks([product],'test-key',undefined,rejectRedirect),new RegExp(`HTTP ${status}`));
   let started=false;
   await assert.rejects(fetchPriceExport('test-key','Netlab',rejectRedirect,async()=>{started=true}));
   assert.equal(started,false);assert.equal(requests,3);
  }
 }finally{await runtime.dispose()}
});

test('отчёт показывает код ошибки API и скрывает произвольные сообщения',()=>{
 assert.match(priceSweepFailureMessage(new Error('RouterAI: HTTP 402')),/RouterAI вернул HTTP 402/);
 assert.equal(priceSweepFailureMessage(new Error('секретный-ключ и тело ответа')).includes('секретный-ключ'),false);
});
