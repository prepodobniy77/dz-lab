import {FeedError, readFeedBody} from './retail-feed.ts';

function httpsUrl(value: string | URL) {
  let url: URL;
  try { url = new URL(value); } catch { throw new FeedError('Некорректный URL источника.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new FeedError('Для источника требуется HTTPS URL без учётных данных.');
  }
  return url;
}

export async function downloadFeed(input: string, configuredUrl?: string, token?: string, request = fetch) {
  const initial = httpsUrl(input);
  const authorization = token && configuredUrl && httpsUrl(configuredUrl).origin === initial.origin
    ? {Authorization:'Bearer '+token} : undefined;
  const signal = AbortSignal.timeout(60_000);
  let url = initial;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request(url,{redirect:'manual',signal,headers:authorization})
      .catch(() => {throw new FeedError('Не удалось получить фид за 60 секунд.');});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new FeedError('Источник вернул редирект без адреса.');
      url = httpsUrl(new URL(location,url));
      if (url.origin !== initial.origin) throw new FeedError('Редирект фида на другой хост запрещён.');
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FeedError('Источник вернул HTTP '+response.status+'.');
    }
    const header = response.headers.get('last-modified');
    const modified = header && Date.parse(header);
    return {
      text:await readFeedBody(response.body,response.headers.get('content-length')),
      lastModified:typeof modified === 'number' && Number.isFinite(modified)
        ? new Date(modified).toISOString() : undefined,
    };
  }
  throw new FeedError('Слишком много редиректов фида.');
}
