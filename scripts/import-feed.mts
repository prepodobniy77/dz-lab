import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {
  FEED_PART_SIZE, FeedError, StaleFeedError, feedStore, parseRetailFeed, readFeedBody, requireFreshFeed,
} from '../lib/retail-feed.ts';
import {providers} from '../lib/providers/index.ts';
import {sourceIsDue} from '../lib/source-policy.ts';
import {downloadFeed} from '../lib/feed-download.ts';

async function run() {
  const args = process.argv.slice(2);
  const input = args.find(arg => !arg.startsWith('--')) ?? process.env.DNS_FEED_URL;
  const bootstrap = args.includes('--bootstrap');
  const force = args.includes('--force');
  if (!input) throw new FeedError('Использование: node scripts/import-feed.mts <файл или HTTPS URL> [--store=DNS] [--date=ISO] [--bootstrap] [--force]');
  const store = feedStore(args.find(arg => arg.startsWith('--store='))?.slice(8) ?? 'DNS');
  const date = args.find(arg => arg.startsWith('--date='))?.slice(7);
  const token = process.env.PRICE_JOB_TOKEN;
  const site = process.env.SITE_URL;
  if (!token || !site) throw new FeedError('Задай SITE_URL и PRICE_JOB_TOKEN.');
  const origin = new URL(site);
  const local = origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !local) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new FeedError('SITE_URL должен быть корнем сайта по HTTPS.');
  }

  if(args.includes('--scheduled')) {
    const response=await fetch(new URL('/api/prices/sources',origin),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new FeedError('Не удалось проверить свежесть источника перед импортом.');
    const status=await response.json() as {sources:{store:string;newestPriceAt:string|null}[]};
    const previous=status.sources.find(s=>s.store===store);
    if(previous&&!sourceIsDue(store,process.env,previous.newestPriceAt)) {console.log('Источник уже обновлён; запуск пропущен.');return}
  }
  let text: string;
  let lastModified: string | undefined;
  if (/^https?:\/\//i.test(input)) {
    const source = await downloadFeed(input,process.env.DNS_FEED_URL,store === 'DNS' ? process.env.DNS_FEED_TOKEN : undefined);
    ({text,lastModified} = source);
  } else {
    const file = await stat(input);
    if (!file.isFile()) throw new FeedError('Ожидается обычный файл.');
    text = await readFeedBody(Readable.toWeb(createReadStream(input)) as unknown as ReadableStream<Uint8Array>,String(file.size));
  }

  const provider=providers.find(p=>p.store===store&&p.source==='feed');
  const batch = provider?await provider.fetchOffers({products:[],config:process.env,input:{text,date,lastModified}}):null;
  const feed = batch?{checkedAt:batch.exportedAt,rows:batch.rows!}:parseRetailFeed(text,date,Date.now(),lastModified);
  requireFreshFeed(feed.checkedAt,process.env.FEED_MAX_AGE_HOURS);
  const parts = Math.max(1,Math.ceil(feed.rows.length/FEED_PART_SIZE));
  const fingerprint = createHash('sha256').update(JSON.stringify({store,checkedAt:feed.checkedAt,parts,bootstrap,force})).update(text).digest('hex');
  async function send(stage: string, payload: object) {
    const url = new URL('/api/prices/import',origin);
    url.searchParams.set('stage',stage);
    if (stage === 'start' && bootstrap) url.searchParams.set('bootstrap','1');
    if (stage === 'start' && force) url.searchParams.set('force','1');
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url,{
        method:'POST', redirect:'error', signal:AbortSignal.timeout(60_000),
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as Record<string,unknown>;
      if (response.status === 409 && stage === 'start') {
        const existing = result.session as Record<string,unknown> | undefined;
        if (existing?.fingerprint === fingerprint) return existing;
      }
      if (response.status === 429 && attempt < 3) {
        const delay = Math.min(180, Math.max(1,Number(response.headers.get('Retry-After')) || 5));
        await sleep(delay * 1000);
        continue;
      }
      if (response.status === 422 && stage === 'commit' && result.status === 'rejected') {
        console.log(JSON.stringify(result));
        throw new FeedError('Прайс отклонён. Подтверждено меньше 80% позиций.');
      }
      if (!response.ok) throw new FeedError('Импорт вернул HTTP '+response.status+
        (typeof result.error === 'string'?' · '+result.error:''));
      return result;
    }
  }

  const session = await send('start',{store,checkedAt:feed.checkedAt,parts,fingerprint});
  if (typeof session.id !== 'string' || typeof session.nextPart !== 'number') throw new FeedError('Не получен курсор импорта.');
  for (let part = session.nextPart; part < parts; part++) {
    await send('rows',{id:session.id,part,rows:feed.rows.slice(part*FEED_PART_SIZE,(part+1)*FEED_PART_SIZE)});
  }
  console.log(JSON.stringify(await send('commit',{id:session.id})));
}

try {
  await run();
} catch (error) {
  if (error instanceof StaleFeedError) console.log(JSON.stringify({status:'stale'}));
  console.error(error instanceof FeedError ? error.message : 'Не удалось прочитать прайс или завершить импорт.');
  process.exitCode = 1;
}
