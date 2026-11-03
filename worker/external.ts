import worker from './index';
import {externalRequest} from '../lib/external-request';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: Parameters<typeof worker.fetch>[2]) {
    const path = new URL(request.url).pathname;
    if (path === '/mcp' || path === '/signin-with-chatgpt' || path === '/signout-with-chatgpt' || path === '/callback') {
      return new Response('Вход не требуется. Сборки сохраняются в этом браузере.', {status: 404});
    }
    if (path === '/api/builds' || path.startsWith('/api/builds/')) {
      return Response.json({error: 'Сборки сохраняются только в браузере.'}, {status: 404});
    }
    return worker.fetch(externalRequest(request), env, ctx);
  },
};
