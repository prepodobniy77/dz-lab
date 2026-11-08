import {database, snapshot} from '../lib/catalog-server';
import {
  cleanupFeedImports, commitFeedImport, feedCooldown, feedImportExpired, FeedConflictError, FeedRateError, privateFeedImports, publicFeedImports, readFeedImport,
  stageFeedRows, startFeedImport,
} from '../lib/feed-import-store';
import {
  FEED_PART_SIZE, MAX_FEED_BYTES, MAX_FEED_ROWS, FeedError, StaleFeedError, feedDate,
  feedStore, indexFeedCatalog, parseRetailFeed, readFeedBody, requireFreshFeed, type FeedRow,
} from '../lib/retail-feed';
import {listFeedReviews, moderateFeedReview} from '../lib/feed-reviews';
import {acquirePriceLease} from '../lib/price-lease';
import {SweepIntervalError} from '../lib/price-job-errors';
import {verifyPriceJobBearer} from '../lib/price-job-access';
import type {Offer} from '../lib/catalog-types';
import type {StoreId} from '../lib/stores';

const headers = {'Cache-Control':'no-store'};

const authorized = (request: Request, env: Cloudflare.Env) =>
  verifyPriceJobBearer(request.headers.get('authorization') ?? '',env.PRICE_JOB_TOKEN);

const busy = (error: SweepIntervalError) => Response.json({error:error.message,reason:error.reason},{
  status:429,headers:{...headers,'Retry-After':String(error.retryAfter)},
});
const maxParts = Math.ceil(MAX_FEED_ROWS / FEED_PART_SIZE);
const indexes = new Map<StoreId, ReturnType<typeof indexFeedCatalog>>();
async function indexFor(db: D1Database, store: StoreId) {
  const cached = indexes.get(store);
  const index = cached ?? indexFeedCatalog(snapshot.products,store);
  if (!cached) indexes.set(store,index);
  if (index.expected >= 100) return index;
  const {results} = await db.prepare('SELECT product_id,data FROM price_offers WHERE store=? AND is_seed=0')
    .bind(store).all<{product_id:string;data:string}>();
  if (!results.length) return index;
  const live = new Map(results.map(row => [row.product_id,JSON.parse(row.data) as Offer]));
  return indexFeedCatalog(snapshot.products.map(product => {
    const offer = live.get(product.id);
    return offer ? {...product,offers:[...product.offers.filter(previous => previous.store!==store),offer]} : product;
  }),store);
}

function readMessage(body: string) {
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string,unknown>;
  } catch {}
  throw new FeedError('Ожидается объект JSON.');
}

function importId(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) {
    throw new FeedError('Некорректный ID импорта.');
  }
  return value;
}

export async function serveFeedImport(request: Request, env: Cloudflare.Env) {
  const method = request.method;
  const {searchParams} = new URL(request.url);
  const details = searchParams.get('details') === '1';
  if (method === 'GET' && !details) return Response.json({stores:await publicFeedImports(database(env))},{headers});
  if (method !== 'POST' && method !== 'GET') return Response.json({error:'Метод недоступен'},{status:405,headers:{...headers,Allow:'GET, POST'}});
  if (!await authorized(request,env)) {
    return Response.json({error:'Доступ запрещён'},{status:401,headers});
  }
  if (method === 'GET') return Response.json({imports:await privateFeedImports(database(env))},{headers});
  const stage = searchParams.get('stage');
  const bootstrap = searchParams.get('bootstrap') === '1';
  const force = searchParams.get('force') === '1';
  if (stage !== null && !['start','rows','commit'].includes(stage)) {
    return Response.json({error:'Неизвестный этап импорта'},{status:400,headers});
  }

  const db = database(env);
  const length = request.headers.get('content-length');
  const limit = stage === null ? MAX_FEED_BYTES : 1024 * 1024;
  const tooLarge = () => Response.json({error:'Превышен размер тела запроса.'},{status:413,headers});
  if (length && Number(length) > limit) return tooLarge();
  let releaseLease: (() => Promise<void>) | undefined;
  try {
    const body = await readFeedBody(request.body,length,limit);
    releaseLease = await acquirePriceLease(db);
    if (stage === null) {
      const store = feedStore(request.headers.get('x-feed-store') ?? 'DNS');
      const feed = parseRetailFeed(body,request.headers.get('x-feed-date') ?? undefined);
      requireFreshFeed(feed.checkedAt,env.FEED_MAX_AGE_HOURS);
      const index = await indexFor(db,store);
      const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(JSON.stringify({store,checkedAt:feed.checkedAt,bootstrap,force})+'\n'+body)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
      const id = await startFeedImport(db,store,feed.checkedAt,index.expected,1,{rateLimit:true,fingerprint,bootstrap,force})
        .catch(error => {
          if (error instanceof FeedConflictError && error.session.fingerprint === fingerprint) return error.session.id;
          throw error;
        });
      const batch = await readFeedImport(db,id);
      if (batch.next_part === 0) await stageFeedRows(db,batch,0,feed.rows,index);
      const report = await commitFeedImport(db,await readFeedImport(db,id));
      return Response.json(report,{status:report.status==='rejected'?422:200,headers});
    }

    const message = readMessage(body);
    if (stage === 'start') {
      const store = feedStore(message.store ?? 'DNS');
      const parts = message.parts;
      if (typeof parts !== 'number' || !Number.isInteger(parts) || parts < 1 || parts > maxParts) {
        throw new FeedError('Некорректное число порций.');
      }
      const checkedAt = feedDate(message.checkedAt);
      requireFreshFeed(checkedAt,env.FEED_MAX_AGE_HOURS);
      const fingerprint = message.fingerprint;
      if (fingerprint !== undefined && (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint))) {
        throw new FeedError('Некорректный отпечаток прайса.');
      }
      const id = await startFeedImport(db,store,checkedAt,(await indexFor(db,store)).expected,parts,{rateLimit:true,fingerprint,bootstrap,force});
      const batch = await readFeedImport(db,id);
      return Response.json({id,nextPart:batch.next_part},{status:201,headers});
    }

    const batch = await readFeedImport(db,importId(message.id));
    if (feedImportExpired(batch)) await cleanupFeedImports(db);
    if (batch.status === 'abandoned' || feedImportExpired(batch)) {
      throw new FeedError('Сеанс импорта истёк. Начни загрузку заново.');
    }
    if (stage === 'rows') {
      const part = message.part;
      if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 ||
          !Array.isArray(message.rows) || message.rows.length > FEED_PART_SIZE) {
        throw new FeedError('Некорректная порция прайса.');
      }
      const nextPart = await stageFeedRows(db,batch,part,message.rows as FeedRow[],await indexFor(db,batch.store));
      return Response.json({nextPart},{headers});
    }

    const report = await commitFeedImport(db,batch);
    return Response.json(report,{status:report.status==='rejected'?422:200,headers});
  } catch (error) {
    if (error instanceof SweepIntervalError) return busy(error);
    if (error instanceof FeedConflictError) return Response.json({error:error.message,session:{
      id:error.session.id,nextPart:error.session.next_part,fingerprint:error.session.fingerprint,
    }},{status:409,headers});
    if (error instanceof FeedRateError) return Response.json({error:error.message},
      {status:429,headers:{...headers,'Retry-After':String(feedCooldown)}});
    if (!(error instanceof FeedError)) throw error;
    if (error instanceof StaleFeedError) return Response.json({status:'stale',error:error.message},{status:422,headers});
    if (error.message === 'Превышен размер тела запроса.') return tooLarge();
    return Response.json({error:error.message},{status:400,headers});
  } finally {
    await releaseLease?.();
  }
}


export async function serveFeedReviews(request: Request, env: Cloudflare.Env) {
  if (!await authorized(request,env)) return Response.json({error:'Доступ запрещён'},{status:401,headers});
  const db = database(env);
  if (request.method === 'GET') {
    const cursor = new URL(request.url).searchParams.get('after') ?? '';
    return Response.json(await listFeedReviews(db,cursor.slice(0,512)),{headers});
  }
  if (request.method !== 'POST') return Response.json({error:'Метод недоступен'},{status:405,headers:{...headers,Allow:'GET, POST'}});

  let releaseLease: (() => Promise<void>) | undefined;
  try {
    const body = await readFeedBody(request.body,request.headers.get('content-length'),4096);
    const {store,productId,checkedAt,action} = readMessage(body);
    if (typeof productId !== 'string' || !productId || productId.length>256 ||
        (action !== 'accept' && action !== 'reject')) throw new FeedError('Нужны productId и действие accept или reject.');
    const candidate = {store:feedStore(store),productId,checkedAt:feedDate(checkedAt)};
    releaseLease = await acquirePriceLease(db);
    const changed = await moderateFeedReview(db,{...candidate,action});
    return changed ? Response.json({status:action==='accept'?'accepted':'rejected'},{headers}) :
      Response.json({error:'Предложение изменилось, истекло или уже проверено.'},{status:409,headers});
  } catch (error) {
    if (error instanceof SweepIntervalError) return busy(error);
    if (error instanceof FeedError) return Response.json({error:error.message},{status:400,headers});
    throw error;
  } finally {
    await releaseLease?.();
  }
}
