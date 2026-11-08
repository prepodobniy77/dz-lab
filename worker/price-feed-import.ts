import {database, snapshot} from '../lib/catalog-server';
import {
  cleanupFeedImports, commitFeedImport, feedCooldown, FeedConflictError, FeedRateError, publicFeedImports, readFeedImport,
  stageFeedRows, startFeedImport,
} from '../lib/feed-import-store';
import {
  FEED_PART_SIZE, MAX_FEED_BYTES, MAX_FEED_ROWS, FeedError, StaleFeedError, feedDate,
  feedStore, indexFeedCatalog, parseRetailFeed, readFeedBody, requireFreshFeed, type FeedRow,
} from '../lib/retail-feed';
import {acquirePriceLease} from '../lib/price-lease';
import {SweepIntervalError} from '../lib/price-job-errors';
import {verifyPriceJobBearer} from '../lib/price-job-access';
import type {StoreId} from '../lib/stores';

const headers = {'Cache-Control':'no-store'};
const maxParts = Math.ceil(MAX_FEED_ROWS / FEED_PART_SIZE);
const indexes = new Map<StoreId, ReturnType<typeof indexFeedCatalog>>();
function indexFor(store: StoreId) {
  const cached = indexes.get(store);
  if (cached) return cached;
  const index = indexFeedCatalog(snapshot.products,store);
  indexes.set(store,index);
  return index;
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
  if (method === 'GET') return Response.json({stores:await publicFeedImports(database(env))},{headers});
  if (method !== 'POST') return Response.json({error:'Метод недоступен'},{status:405,headers:{...headers,Allow:'GET, POST'}});
  if (!await verifyPriceJobBearer(request.headers.get('authorization') ?? '',env.PRICE_JOB_TOKEN)) {
    return Response.json({error:'Доступ запрещён'},{status:401,headers});
  }
  const stage = new URL(request.url).searchParams.get('stage');
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
    if (stage === 'rows' || stage === 'commit') await cleanupFeedImports(db);
    if (stage === null) {
      const store = feedStore(request.headers.get('x-feed-store') ?? 'DNS');
      const feed = parseRetailFeed(body,request.headers.get('x-feed-date') ?? undefined);
      requireFreshFeed(feed.checkedAt,env.FEED_MAX_AGE_HOURS);
      const index = indexFor(store);
      const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(feed.checkedAt+'\n'+body)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
      const id = await startFeedImport(db,store,feed.checkedAt,index.expected,1,{rateLimit:true,fingerprint})
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
      const id = await startFeedImport(db,store,checkedAt,indexFor(store).expected,parts,{rateLimit:true,fingerprint});
      const batch = await readFeedImport(db,id);
      return Response.json({id,nextPart:batch.next_part},{status:201,headers});
    }

    const batch = await readFeedImport(db,importId(message.id));
    if (batch.status === 'abandoned') throw new FeedError('Сеанс импорта истёк. Начни загрузку заново.');
    if (stage === 'rows') {
      const part = message.part;
      if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 ||
          !Array.isArray(message.rows) || message.rows.length > FEED_PART_SIZE) {
        throw new FeedError('Некорректная порция прайса.');
      }
      const nextPart = await stageFeedRows(db,batch,part,message.rows as FeedRow[],indexFor(batch.store));
      return Response.json({nextPart},{headers});
    }

    const report = await commitFeedImport(db,batch);
    return Response.json(report,{status:report.status==='rejected'?422:200,headers});
  } catch (error) {
    if (error instanceof SweepIntervalError) {
      return Response.json({error:error.message,reason:error.reason},{status:429,
        headers:{...headers,'Retry-After':String(error.retryAfter)}});
    }
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
