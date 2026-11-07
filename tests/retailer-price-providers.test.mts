import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {refreshDns, refreshDnsAnysite} from '../scripts/refresh-dns-provider.mts';
import type {CatalogData, Offer} from '../lib/catalog-types';
import type {StoreRefresh} from '../lib/price-feed.ts';

const productId = '96054164afeaed20';
const url = 'https://www.dns-shop.ru/product/' + productId + '/processor-amd-ryzen-7-5700x-oem/';
const baseOffer: Offer = {store:'DNS',url,price:13000,checkedAt:'2026-01-01T01:00:00Z',availability:'in-stock',status:'ok'};
const catalog: CatalogData = {
  region:'Москва',importedAt:baseOffer.checkedAt,sources:[],
  products:[{id:'cpu',category:'cpu',name:'Ryzen 7 5700X OEM',brand:'AMD',mpn:'',image:'',description:'',specs:{},offers:[baseOffer]}],
};
const initial = ():StoreRefresh => ({store:'DNS',requests:0,updated:0,failures:0,review:0});

test('Reef stops at available credits and publishes only the known regular DNS offer', async t => {
  const feedDate = new Date().toISOString();
  const mocked = t.mock.method(globalThis,'fetch', async (input: string, init?:RequestInit) => {
    if (input.endsWith('/credits')) return Response.json({remaining:5});
    assert.equal(JSON.parse(String(init?.body)).page,1);
    return Response.json({
      ok:true,meta:{api:'dns-shop',endpoint:'search',mode:'live',cache_hit:false,currency:'RUB',charged_credits:3,fetched_at:feedDate},
      data:{category_id:'17a899cd16404e77',page:1,last_page:10,results:[
        {url,product_id:productId,name:'Ryzen 7 5700X OEM',price:14990,orderable:true,avail_status:'now'},
        {url,product_id:productId,name:'Уценка',price:7000,orderable:true,is_markdown:true},
      ]},
    });
  });
  const report = initial();
  const saved: Offer[] = [];
  await refreshDns(catalog,'test-key',18,undefined,report,(_,offer)=>saved.push(offer),Date.now()+1000);
  assert.equal(mocked.mock.calls.length,2);
  assert.equal(report.requests,1);
  assert.equal(report.cursor,1);
  assert.deepEqual(saved.map(offer=>[offer.url,offer.price,offer.checkedAt]),[[url,14990,feedDate]]);
});

test('Anysite requires the named Moscow city and exact DNS URL SKU', async t => {
  t.mock.method(globalThis,'fetch', async (_input:string, init?:RequestInit) => {
    const query = JSON.parse(String(init?.body));
    assert.equal(query.city,'Москва');
    assert.equal(query.category,'17a899cd16404e77');
    return Response.json([
      {url,hex_id:productId,city:'Санкт-Петербург',price:8000},
      {url,hex_id:'abcdef1234567890',city:'Москва',price:9000},
      {url,hex_id:productId,city:'Москва',price:15490,availability:{status:'now'}},
    ]);
  });
  const report = initial();
  const prices:number[] = [];
  await refreshDnsAnysite(catalog,'test-key',1,undefined,report,(_,offer)=>{
    prices.push(offer.price!);
    report.updated++;
  },Date.now()+1000);
  assert.deepEqual(prices,[15490]);
  assert.equal(report.blocked,undefined);
});

test('Citilink YML reads ordinary ruble price, keeps original time, and excludes redirects and conflicts', async () => {
  const dir = await mkdtemp(join(tmpdir(),'dz-citilink-yml-'));
  try {
    const date = new Date().toISOString();
    const path = join(dir,'offers.xml');
    const card = (id:number, price:number, host='www.citilink.ru') => '<offer id="'+id+'" available="true"><url>https://'+host+'/product/component-'+id+'/</url><price>'+price+'</price><oldprice>22000</oldprice><currencyId>RUB</currencyId></offer>';
    await writeFile(path,'<yml_catalog date="'+date+'"><shop><offers>'+card(123456,15000)+card(345678,1,'tracking.example')+card(234567,15000)+card(234567,18000)+'</offers></shop></yml_catalog>');
    const parsed = JSON.parse(execFileSync('python3',['scripts/read-citilink-yml.py',path],{encoding:'utf8'}));
    assert.equal(Date.parse(parsed.checkedAt),Date.parse(date));
    assert.deepEqual(parsed.rows,[{sku:'123456',price:15000,available:true}]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
