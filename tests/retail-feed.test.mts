import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import type {Product} from '../lib/catalog-types';
import {
  cleanupFeedImports, commitFeedImport, FeedConflictError, publicFeedImports, readFeedImport, reserveFeedImport, stageFeedRows, startFeedImport,
} from '../lib/feed-import-store.ts';
import {listFeedReviews, moderateFeedReview} from '../lib/feed-reviews.ts';
import {acquirePriceLease} from '../lib/price-lease.ts';
import {indexFeedCatalog, parseRetailFeed, readFeedBody, type FeedRow} from '../lib/retail-feed.ts';

const baseline = '2026-01-01T00:00:00.000Z';
const date = '2026-01-02T00:00:00.000Z';
const now = Date.parse('2026-01-04T00:00:00Z');
const products: Product[] = Array.from({length:5},(_,i) => ({
  id:'p'+i, category:'cpu', name:'Same name', brand:'', mpn:'PART-'+i, image:'', specs:{}, description:'',
  offers:[{
    store:'DNS', url:'https://www.dns-shop.ru/product/'+String(i).padStart(16,'0')+'/part/',
    sku:'retail-'+i, price:1000, availability:'in-stock', checkedAt:baseline, status:'ok',
  }],
}));
const index = indexFeedCatalog(products,'DNS');
const row = (i: number, price = 1200): FeedRow => ({
  mpn:'PART-'+i, sku:'', url:'', price, availability:'in-stock',
});

test('MPN, SKU and store URL identify a product without name matching', () => {
  assert.equal(index.match({...row(2),mpn:' part-2 '})?.product.id,'p2');
  assert.equal(index.match({...row(1),mpn:'',sku:'retail-1'})?.product.id,'p1');
  assert.equal(index.match({...row(2),mpn:'',sku:'0000000000000002'})?.product.id,'p2');
  assert.equal(index.match({...row(3),mpn:'',url:products[3].offers[0].url})?.product.id,'p3');
  assert.equal(index.match({...row(0),mpn:'Same name'}),null);
  assert.equal(index.match({...row(0),sku:'retail-1'}),null);
  assert.equal(index.match({...row(0),url:products[1].offers[0].url}),null);
  assert.equal(index.match({...row(0),url:'https://other.example/product/0000000000000000/part/'}),null);
});

test('CSV, YML and XML normalize dates and availability and reject invalid prices', () => {
  const csv = 'mpn;price;available;date\nPART-1;"1,25";true;2026-01-02 03:00\nPART-2;0;true;2026-01-02 03:00\nPART-3;-1;true;2026-01-02 03:00\nPART-4;oops;true;2026-01-02 03:00';
  const parsed = parseRetailFeed(csv,undefined,now);
  assert.equal(parsed.checkedAt,date);
  assert.deepEqual(parsed.rows,[row(1,1.25),...([2,3,4].map(i => ({...row(i),price:null})))]);
  const yml = '<!DOCTYPE yml_catalog SYSTEM "shops.dtd"><yml_catalog date="2026-01-02 03:00"><shop><offers>' +
    '<offer id="retail-2" available="false"><vendorCode>PART-2</vendorCode><price>1000</price><currencyId>RUB</currencyId></offer>' +
    '<offer id="retail-3"><price>NaN</price></offer></offers></shop></yml_catalog>';
  assert.deepEqual(parseRetailFeed(yml,undefined,now).rows,[
    {...row(2,1000),sku:'retail-2',availability:'out-of-stock'},
    {mpn:'',sku:'retail-3',url:'',price:null,availability:'unknown'},
  ]);
  assert.equal(parseRetailFeed('<offers date="'+date+'"><offer mpn="PART-2"><price>1000</price></offer></offers>',undefined,now).rows.length,1);
  assert.throws(() => parseRetailFeed('<!DOCTYPE yml_catalog [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+yml,undefined,now),/DTD/);
  assert.throws(() => parseRetailFeed(csv.replace('2026-01-02 03:00','2026-02-31 03:00'),undefined,now),/Дата/);
  assert.throws(() => parseRetailFeed(csv.replaceAll('2026-01-02 03:00','2026-01-05 03:00'),undefined,now),/будущем/);
  assert.throws(() => parseRetailFeed(csv,date.replace('02T','03T'),now),/разным выгрузкам/);
  for (const price of [0,-1,NaN,Infinity]) assert.equal(index.match(row(0,price)),null);
});

test('the streaming size guard rejects missing and falsified content length', async () => {
  const body = () => new Response('1234').body as ReadableStream<Uint8Array>;
  await assert.rejects(readFeedBody(body(),null,3),/размер/);
  await assert.rejects(readFeedBody(body(),'2',3),/размер/);
  assert.equal(await readFeedBody(body(),null,4),'1234');
});

test('D1 checks 80% before publishing, preserves old dates and stages large jumps', async () => {
  const require = createRequire(import.meta.url);
  const {Miniflare} = createRequire(require.resolve('wrangler/package.json'))('miniflare');
  const runtime = new Miniflare({modules:true,script:'export default {fetch(){return new Response()}}',d1Databases:['DB']});
  try {
    const db = await runtime.getD1Database('DB') as D1Database;
    for (const migration of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort()) {
      const statements = readFileSync('drizzle/'+migration,'utf8').split('--> statement-breakpoint').filter(sql=>sql.trim());
      await db.batch(statements.map(sql=>db.prepare(sql)));
    }
    await db.batch(products.map(product => db.prepare(
      'INSERT INTO price_offers(key,product_id,store,data,attempt_at,is_seed) VALUES (?,?,?,?,?,1)',
    ).bind(product.id+':DNS',product.id,'DNS',JSON.stringify(product.offers[0]),baseline)));
    assert.equal(await reserveFeedImport(db,now),true);
    assert.equal(await reserveFeedImport(db,now+10_000),false);
    assert.equal(await reserveFeedImport(db,now+60_000),true);
    const history = async () => (await db.prepare('SELECT COUNT(*) AS n FROM price_history').first<{n:number}>())!.n;
    const importRows = async (rows: FeedRow[], checkedAt = date) => {
      const id = await startFeedImport(db,'DNS',checkedAt,index.expected,1,{bootstrap:true});
      const batch = await readFeedImport(db,id);
      await assert.rejects(commitFeedImport(db,batch),/не все порции/);
      await stageFeedRows(db,batch,0,rows,index);
      return commitFeedImport(db,await readFeedImport(db,id));
    };

    const rejected = await importRows([row(0),row(1),row(2),row(2),row(3,0)]);
    assert.equal(rejected.matched,3);
    assert.equal(rejected.status,'rejected');
    assert.equal(await history(),0);

    const conflict = await importRows([row(0),row(1),row(2),row(3),row(3,1201)]);
    assert.equal(conflict.matched,3);
    assert.equal(conflict.status,'rejected');

    const accepted = await importRows([row(0,1500),row(1,1501),row(2),row(3)]);
    assert.equal(accepted.status,'published');
    assert.equal(accepted.matched,4);
    assert.equal(accepted.updated,3);
    assert.equal(accepted.pendingReview,1);
    assert.equal(await history(),3);
    const offers = await db.prepare('SELECT product_id,attempt_at FROM price_offers ORDER BY product_id')
      .all<{product_id:string;attempt_at:string}>();
    assert.deepEqual(offers.results.map(offer=>offer.attempt_at),[date,baseline,date,date,baseline]);
    assert.ok(await db.prepare("SELECT 1 FROM source_health WHERE store='PRICE_REVIEW:p1:DNS'").first());

    const repeated = await importRows([row(0),row(1),row(2),row(3)]);
    assert.equal(repeated.updated,0);
    assert.equal(repeated.pendingReview,0);
    const older = await importRows([row(0),row(1),row(2),row(3)],baseline);
    assert.equal(older.updated,0);
    assert.equal(await history(),3);
    const later = '2026-01-03T00:00:00.000Z';
    const concurrent = await Promise.allSettled([1,2].map(() => startFeedImport(db,'DNS',later,index.expected,2,{bootstrap:true})));
    const opened = concurrent.find(result => result.status==='fulfilled');
    const refused = concurrent.find(result => result.status==='rejected');
    assert.ok(opened?.status==='fulfilled');
    assert.ok(refused?.status==='rejected' && refused.reason instanceof FeedConflictError);
    const id = opened.value;
    const initial = await readFeedImport(db,id);
    assert.equal(await stageFeedRows(db,initial,0,[row(0)],index),1);
    const resumed = await readFeedImport(db,id);
    assert.equal(await stageFeedRows(db,resumed,0,[row(0,3000)],index),1);
    assert.equal((await readFeedImport(db,id)).rows_written,resumed.rows_written);
    assert.equal(await stageFeedRows(db,resumed,1,[row(1),row(2),row(3)],index),2);

    // Force a failure after the price history INSERT, before offers become visible.
    await db.prepare(`CREATE TRIGGER fail_feed BEFORE INSERT ON price_offers WHEN NEW.product_id='p1'
      BEGIN SELECT RAISE(ABORT,'publication fault'); END`).run();
    await assert.rejects(commitFeedImport(db,await readFeedImport(db,id)),/publication fault/);
    const interrupted = await readFeedImport(db,id);
    assert.equal(interrupted.status,'publishing');
    assert.equal(interrupted.next_part,2);
    assert.equal(interrupted.finished_at,null);
    assert.equal(await history(),3);
    await db.prepare('DROP TRIGGER fail_feed').run();
    assert.equal((await commitFeedImport(db,interrupted)).status,'published');
    assert.equal((await commitFeedImport(db,await readFeedImport(db,id))).updated,2);

    const abandoned = await startFeedImport(db,'DNS',date,index.expected,2,{now:now+120_000,bootstrap:true});
    await stageFeedRows(db,await readFeedImport(db,abandoned),0,[row(0)],index);
    await cleanupFeedImports(db,now+120_000+2*3_600_000);
    assert.equal((await readFeedImport(db,abandoned)).status,'abandoned');
    assert.equal(await db.prepare('SELECT 1 FROM price_feed_rows WHERE import_id=?').bind(abandoned).first(),null);
    await cleanupFeedImports(db,now+120_000+2*3_600_000+7*86_400_000);
    await assert.rejects(readFeedImport(db,abandoned),/истёк/);
    assert.equal((await publicFeedImports(db))[0].store,'DNS');
    const releaseLease = await acquirePriceLease(db);
    await assert.rejects(acquirePriceLease(db),{reason:'active_portion'});
    await releaseLease();
    await (await acquirePriceLease(db))();

    const jumpAt = '2026-01-05T00:00:00.000Z';
    const confirmAt = '2026-01-06T00:00:00.000Z';
    const jumpRows = [row(0,3000),row(1,3000),row(2),row(3,3000)];
    assert.equal((await importRows(jumpRows,jumpAt)).pendingReview,3);
    const pending = await listFeedReviews(db,'');
    assert.equal(pending.reviews.length,3);
    assert.equal((await importRows(jumpRows,jumpAt)).updated,0);
    const confirmation = await importRows([row(0,3060),row(1,3100),row(2),row(3,3100)],confirmAt);
    assert.equal(confirmation.updated,1);
    assert.equal(confirmation.pendingReview,2);
    assert.equal((await listFeedReviews(db,'')).reviews.length,2);
    const current = async (id: string) => (await db.prepare("SELECT data FROM price_offers WHERE key=?")
      .bind(id+':DNS').first<{data:string}>())!.data;
    assert.equal(JSON.parse(await current('p0')).price,3060);
    assert.equal(JSON.parse(await current('p2')).checkedAt,date);
    assert.equal(await moderateFeedReview(db,{store:'DNS',productId:'p1',checkedAt:jumpAt,action:'accept'}),false);
    assert.equal(await moderateFeedReview(db,{store:'DNS',productId:'p1',checkedAt:confirmAt,action:'accept'}),true);
    assert.equal(JSON.parse(await current('p1')).price,3100);
    assert.equal(await moderateFeedReview(db,{store:'DNS',productId:'p3',checkedAt:confirmAt,action:'reject'}),true);
    assert.equal(JSON.parse(await current('p3')).checkedAt,date);
    await importRows([row(0,9000),row(1,3100),row(2),row(3)],'2026-01-07T00:00:00.000Z');
    await cleanupFeedImports(db,Date.now()+7*86_400_000+1000);
    assert.equal((await listFeedReviews(db,'')).reviews.length,0);
    assert.equal(JSON.parse(await current('p0')).price,3060);

    const firstIndex = indexFeedCatalog(products.map(product => ({...product,offers:[]})),'DNS');
    await assert.rejects(startFeedImport(db,'DNS',date,firstIndex.expected,1),/bootstrap=1/);
    const first = await startFeedImport(db,'DNS',later,firstIndex.expected,1,{bootstrap:true});
    await stageFeedRows(db,await readFeedImport(db,first),0,products.map((product,i) => ({
      ...row(i),url:product.offers[0].url,price:i < 3 ? 1000 : null,
    })),firstIndex);
    const short = await commitFeedImport(db,await readFeedImport(db,first));
    assert.equal(short.recognized,5);
    assert.equal(short.matched,3);
    assert.equal(short.status,'rejected');

    const forced = await startFeedImport(db,'DNS',later,100,1,{force:true});
    await stageFeedRows(db,await readFeedImport(db,forced),0,[row(4)],index);
    assert.equal((await commitFeedImport(db,await readFeedImport(db,forced))).forced,true);
    assert.equal((await readFeedImport(db,forced)).status,'published');
    assert.deepEqual(Object.keys((await publicFeedImports(db))[0]).sort(),['finishedAt','status','store','updated']);
    await db.prepare('DELETE FROM price_offers').run();
    assert.deepEqual(await publicFeedImports(db),[]);
  } finally {
    await runtime.dispose();
  }
});
