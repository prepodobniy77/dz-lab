import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('DNS import preserves variants, original quote dates, other stores and confirmed prices',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'dz-dns-import-'));
 try{
  await mkdir(join(cwd,'data'));await mkdir(join(cwd,'snapshots'));
  const checkedAt=new Date(Date.now()-3600000).toISOString();
  const url='https://www.dns-shop.ru/product/1234567890abcdef/cpu/';
  const product={id:'original-oem',category:'cpu',name:'CPU OEM',brand:'AMD',mpn:'OEM-1234',image:'',description:'',specs:{socket:'AM5'},offers:[{store:'DNS',url,price:10000,checkedAt,status:'ok',availability:'in-stock'},{store:'XCOM',url:'https://www.xcom-shop.ru/product/123/',price:11000,checkedAt,status:'ok',availability:'in-stock'}]};
  await writeFile(join(cwd,'data/catalog.json'),JSON.stringify({products:[product],sources:[{name:'DNS',status:'partial',note:''}],region:'Москва'}));
  const row={guid:'a',sku:'1',name:'CPU OEM',url,priceText:null,availability:'now',availabilityText:'',image:'',attributes:{},checkedAt,transport:'api'};
  await writeFile(join(cwd,'snapshots/cpu.json'),JSON.stringify({source:'validated-dns-catalog',category:'cpu',region:'Москва',url:'https://www.dns-shop.ru/catalog/17a899cd16404e77/',checkedAt:new Date().toISOString(),items:[row,{...row,guid:'b',name:'CPU BOX [BOX-1234]',url:'https://www.dns-shop.ru/product/abcdef1234567890/cpu-box/',priceText:'12 999 ₽'}]}));
  const script=resolve('scripts/import-dns-catalog.mts');
  const run=()=>execFileSync(process.execPath,[script,join(cwd,'snapshots'),'--apply'],{cwd,stdio:'pipe'});
  run();const data=JSON.parse(await readFile(join(cwd,'data/catalog.json'),'utf8'));
  assert.equal(data.products.length,2);assert.equal(data.products[0].id,'original-oem');
  assert.equal(data.products[0].offers.find((o:any)=>o.store==='DNS').price,10000);
  assert.equal(data.products[0].offers.find((o:any)=>o.store==='XCOM').price,11000);
  const box=data.products.find((p:any)=>p.name==='CPU BOX');assert.equal(box.offers[0].checkedAt,checkedAt);assert.equal(box.offers[0].transport,'api');
  run();assert.equal(JSON.parse(await readFile(join(cwd,'data/catalog.json'),'utf8')).products.length,2);
 }finally{await rm(cwd,{recursive:true,force:true})}
});
