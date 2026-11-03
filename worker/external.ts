import worker from './index';
import {externalRequest} from '../lib/external-request';
import catalog from '../data/catalog.json';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: Parameters<typeof worker.fetch>[2]) {
    const path = new URL(request.url).pathname;
    if (path === '/api/catalog' && request.method === 'GET') {
      return Response.json({...catalog, storage: 'snapshot'}, {headers: {'Cache-Control': 'no-store'}});
    }
    if (path.startsWith('/api/prices/')) {
      return request.method === 'GET'
        ? Response.json({report: null}, {headers: {'Cache-Control': 'no-store'}})
        : Response.json({error: 'Обновление цен на этом сайте пока не подключено.'}, {status: 401});
    }
    if (path === '/mcp' || path === '/signin-with-chatgpt' || path === '/signout-with-chatgpt' || path === '/callback') {
      return new Response('Вход не требуется. Сборки сохраняются в этом браузере.', {status: 404});
    }
    if (path === '/api/builds' || path.startsWith('/api/builds/')) {
      return Response.json({error: 'Сборки сохраняются только в браузере.'}, {status: 404});
    }
    return worker.fetch(externalRequest(request), env, ctx);
  },
};
