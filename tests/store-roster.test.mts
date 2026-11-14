import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stores,retiredStoreIds,storeInfo,isAllowedStoreUrl} from '../lib/stores.ts';
import {desktopCatalog} from '../lib/catalog-scope.ts';
import {mergeCatalogOffers} from '../lib/catalog-price-delta.ts';
import {bestOffer} from '../lib/catalog.ts';
import {feedStore,indexFeedCatalog} from '../lib/retail-feed.ts';
import type {CatalogData,Product,Offer} from '../lib/catalog-types';

const date='2026-11-13T09:00:00.000Z';
const offer:Offer={store:'XCOM',url:'https://www.xcom-shop.ru/part.html',price:1000,status:'ok',availability:'in-stock',checkedAt:date};
const product:Product={id:'part',category:'cpu',name:'Part',mpn:'MPN-1',brand:'',description:'',specs:{},image:'',offers:[offer,...retiredStoreIds.map(store=>({...offer,store,price:1}))]};

test('пять удалённых магазинов не принимаются; 28bit имеет только официальный домен',()=>{
 for(const store of retiredStoreIds){assert.equal(storeInfo(store),undefined);assert.throws(()=>feedStore(store));}
 assert.deepEqual(stores.map(s=>s.id),['DELECT','XCOM','REGARD','DNS','CITILINK','ONLINETRADE','BIT28','MVIDEO']);
 assert.equal(feedStore('onlinetrade'),'ONLINETRADE');
 assert.equal(isAllowedStoreUrl('https://www.onlinetrade.ru/product/','ONLINETRADE'),true);
 assert.equal(feedStore('mvideo'),'MVIDEO');
 assert.equal(isAllowedStoreUrl('https://www.mvideo.ru/products/123','MVIDEO'),true);
 assert.equal(feedStore('bit28'),'BIT28');
 assert.equal(isAllowedStoreUrl('https://28bit.ru/product/','BIT28'),true);
 assert.equal(isAllowedStoreUrl('https://28bit.ru.evil.example/product/','BIT28'),false);
});
test('старый снимок и записи базы не возвращают исключённые предложения в каталог и лучшую цену',()=>{
 const raw:CatalogData={products:[product],importedAt:date,region:'Москва',sources:retiredStoreIds.map(name=>({name,status:'ok',note:''}))};
 const catalog=desktopCatalog(raw);
 assert.deepEqual(catalog.products[0].offers,[offer]);
 assert.deepEqual(catalog.sources.map(s=>s.name),['BIT28','MVIDEO']);
 assert.equal(catalog.sources[0].status,'pending');
 assert.equal(bestOffer(product,Date.parse(date))?.store,'XCOM');
 const merged=mergeCatalogOffers(catalog.products[0],product.offers.slice(1));
 assert.deepEqual(merged.offers,[offer]);
 assert.equal(merged.offers[0].checkedAt,date);
});
test('прайс 28bit сопоставляется по MPN без выдумывания предложения до импорта',()=>{
 const index=indexFeedCatalog([{...product,offers:[offer]}],'BIT28');
 const matched=index.match({mpn:'MPN-1',sku:'',url:'https://28bit.ru/part/',price:1100,availability:'in-stock'},{bootstrap:true});
 assert.equal(matched?.product.id,'part');
 assert.equal(matched?.offer.store,'BIT28');
 assert.equal(index.match({mpn:'UNKNOWN',sku:'',url:'https://28bit.ru/other/',price:1100,availability:'in-stock'}),null);
});
