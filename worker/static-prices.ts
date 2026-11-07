const feedUrl = 'https://raw.githubusercontent.com/prepodobniy77/dz-lab/price-snapshots/price-feed.json';
const empty = () => Response.json({report: null}, {headers: {'Cache-Control': 'no-store'}});

export default {
  async fetch(request: Request, env: {ASSETS: Fetcher}): Promise<Response> {
    if (new URL(request.url).pathname !== '/api/prices/current') return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response(null, {status: 405, headers: {Allow: 'GET'}});
    try {
      const upstream = await fetch(feedUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        cf: {cacheEverything: true, cacheTtlByStatus: {'200': 120, '404': 15, '500-599': 0}},
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return empty();
      }
      return new Response(upstream.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return empty();
    }
  },
};
