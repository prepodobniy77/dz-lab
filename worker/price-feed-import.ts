import {database, snapshot} from '../lib/catalog-server';
import {
  commitFeedImport, feedCooldown, publicFeedImports, readFeedImport,
  reserveFeedImport, stageFeedRows, startFeedImport,
} from '../lib/feed-import-store';
import {
  FEED_PART_SIZE, MAX_FEED_BYTES, MAX_FEED_ROWS, FeedError, StaleFeedError, feedDate,
  feedStore, indexFeedCatalog, parseRetailFeed, readFeedBody, requireFreshFeed, type FeedRow,
} from '../lib/retail-feed';
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
  if ((stage === null || stage === 'start') && !await reserveFeedImport(db)) {
    return Response.json({error:'Следующий импорт можно начать через минуту.'},
      {status:429,headers:{...headers,'Retry-After':String(feedCooldown)}});
  }

  try {
    const body = await readFeedBody(request.body,length,limit);
    if (stage === null) {
      const store = feedStore(request.headers.get('x-feed-store') ?? 'DNS');
      const feed = parseRetailFeed(body,request.headers.get('x-feed-date') ?? undefined);
      requireFreshFeed(feed.checkedAt,env.FEED_MAX_AGE_HOURS);
      const index = indexFor(store);
      const id = await startFeedImport(db,store,feed.checkedAt,index.expected,1);
      const batch = await readFeedImport(db,id);
      await stageFeedRows(db,batch,0,feed.rows,index);
      const report = await commitFeedImport(db,{...batch,next_part:1});
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
      const id = await startFeedImport(db,store,checkedAt,indexFor(store).expected,parts);
      return Response.json({id},{status:201,headers});
    }

    const batch = await readFeedImport(db,importId(message.id));
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
    if (!(error instanceof FeedError)) throw error;
    if (error instanceof StaleFeedError) return Response.json({status:'stale',error:error.message},{status:422,headers});
    if (error.message === 'Превышен размер тела запроса.') return tooLarge();
    return Response.json({error:error.message},{status:400,headers});
  }
}
