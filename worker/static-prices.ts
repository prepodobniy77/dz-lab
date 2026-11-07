const feedUrl = 'https://raw.githubusercontent.com/prepodobniy77/dz-lab/price-snapshots/price-feed.json';
const empty = (state: string) => Response.json({report: null}, {
  headers: {'Cache-Control': 'no-store', 'X-DZ-Price-Feed': state},
});

export default {
  async fetch(request: Request, env: {ASSETS: Fetcher}): Promise<Response> {
    if (new URL(request.url).pathname !== '/api/prices/current') return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response(null, {status: 405, headers: {Allow: 'GET'}});
    try {
      // A cached 404 from before the first publication must expire as the branch appears.
      const window = Math.floor(Date.now() / 120_000);
      const upstream = await fetch(feedUrl + '?window=' + window, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        cf: {cacheEverything: true, cacheTtlByStatus: {'200': 120, '404': 15, '500-599': 0}},
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return empty('upstream-' + upstream.status);
      }
      return new Response(upstream.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return empty('upstream-unavailable');
    }
  },
};
