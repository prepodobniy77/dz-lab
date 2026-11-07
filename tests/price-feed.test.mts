import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPriceFeed, parsePriceFeed, type PriceFeed} from '../lib/price-feed.ts';
import type {CatalogData, Offer} from '../lib/catalog-types';

const first = '2026-11-05T10:00:00Z';
const second = '2026-11-06T10:00:00Z';
const third = '2026-11-07T10:00:00Z';
const offer: Offer = {store:'REGARD',url:'https://www.regard.ru/product/1/cpu',price:9000,
  checkedAt:first,availability:'in-stock',status:'ok'};
const base: CatalogData = {region:'Москва',importedAt:first,
  sources:[{name:'REGARD',note:'',status:'ok',checkedAt:first}],
  products:[{id:'cpu',category:'cpu',name:'CPU',brand:'',mpn:'',image:'',specs:{},description:'',offers:[offer]}]};

test('price feed keeps the last verified quote across a blocked cycle and rejects different variants', () => {
  const feed: PriceFeed = {version:1,region:'Москва',report:{checkedAt:third,status:'blocked',attempted:1,updated:0,lastSuccessfulAt:second},
    stores:[{store:'REGARD',blocked:'HTTP 429',requests:1,updated:0,failures:1,review:0}],observations:[
      {productId:'cpu',offer:{...offer,price:9500,checkedAt:second}},
      {productId:'cpu',offer:{...offer,url:'https://www.regard.ru/product/2/cpu-box',price:4000,checkedAt:third}},
      {productId:'cpu',offer:{...offer,price:100,checkedAt:'2026-11-08T10:00:00Z'}},
    ]};
  const parsed = parsePriceFeed(feed, Date.parse(third));
  assert.ok(parsed);
  const data = applyPriceFeed(base,parsed);
  assert.equal(data.products[0].offers[0].price,9500);
  assert.equal(data.products[0].offers[0].checkedAt,second);
  assert.equal(data.sources[0].checkedAt,second);
  assert.equal(data.sources[0].status,'limited');
  assert.equal(base.products[0].offers[0].price,9000);
});
