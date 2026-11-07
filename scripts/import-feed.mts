import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {
  FEED_PART_SIZE, FeedError, feedStore, parseRetailFeed, readFeedBody,
} from '../lib/retail-feed.ts';

async function run() {
  const [input = process.env.DNS_FEED_URL, ...args] = process.argv.slice(2);
  if (!input) throw new FeedError('Использование: node scripts/import-feed.mts <файл или HTTPS URL> [--store=DNS] [--date=ISO]');
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

  let text: string;
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new FeedError('Для источника требуется HTTPS URL.');
    const sourceToken = store === 'DNS' ? process.env.DNS_FEED_TOKEN : undefined;
    const source = await fetch(url,{
      redirect:'error', signal:AbortSignal.timeout(60_000),
      headers:sourceToken?{Authorization:'Bearer '+sourceToken}:undefined,
    }).catch(() => {throw new FeedError('Не удалось получить файл источника.');});
    if (!source.ok) throw new FeedError('Источник вернул HTTP '+source.status+'.');
    text = await readFeedBody(source.body,source.headers.get('content-length'));
  } else {
    const file = await stat(input);
    if (!file.isFile()) throw new FeedError('Ожидается обычный файл.');
    text = await readFeedBody(Readable.toWeb(createReadStream(input)) as unknown as ReadableStream<Uint8Array>,String(file.size));
  }

  const feed = parseRetailFeed(text,date);
  const parts = Math.max(1,Math.ceil(feed.rows.length/FEED_PART_SIZE));
  async function send(stage: string, payload: object) {
    const url = new URL('/api/prices/import',origin);
    url.searchParams.set('stage',stage);
    const response = await fetch(url,{
      method:'POST', redirect:'error', signal:AbortSignal.timeout(60_000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as Record<string,unknown>;
    if (response.status === 422 && stage === 'commit' && result.status === 'rejected') {
      console.log(JSON.stringify(result));
      throw new FeedError('Прайс отклонён. Подтверждено меньше 80% известных позиций.');
    }
    if (!response.ok) throw new FeedError('Импорт вернул HTTP '+response.status+
      (typeof result.error === 'string'?' · '+result.error:''));
    return result;
  }

  const session = await send('start',{store,checkedAt:feed.checkedAt,parts});
  if (typeof session.id !== 'string') throw new FeedError('Не получен ID импорта.');
  for (let part = 0; part < parts; part++) {
    await send('rows',{id:session.id,part,rows:feed.rows.slice(part*FEED_PART_SIZE,(part+1)*FEED_PART_SIZE)});
  }
  console.log(JSON.stringify(await send('commit',{id:session.id})));
}

try {
  await run();
} catch (error) {
  console.error(error instanceof FeedError ? error.message : 'Не удалось прочитать прайс или завершить импорт.');
  process.exitCode = 1;
}
