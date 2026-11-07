import {database, snapshotById} from '../lib/catalog-server';
import {readCatalogPriceDelta} from '../lib/catalog-price-delta';
import {verifyPriceJobBearer} from '../lib/price-job-access';
import {priceSweepFailureMessage, ScheduledSweepError, SweepIntervalError} from '../lib/price-job-errors';
import {readPublicSweepReport, readSweepHistory, readSweepReport} from '../lib/price-report-store';
import {recordFailedSweep, runPriceSweep} from '../lib/price-sweep';
import type {CycleResult} from '../lib/price-cycle';
import type {SweepReport} from '../lib/hourly-prices';
import type {PublicSweepReport} from '../lib/price-status';
import type {PriceFeed} from '../lib/price-feed';
import {catalogResponse} from './catalog-response';
import {serveFeedImport} from './price-feed-import';
import {storeInfo} from '../lib/stores';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...headers}});
const denied = () => json({error: 'Доступ запрещён'}, 401);

async function servePrices(request: Request, path: string, env: Cloudflare.Env) {
  if (path === '/api/prices/import') return serveFeedImport(request,env);
  if (request.method === 'GET') {
    if (path === '/api/prices/sweep') return json({report: await readPublicSweepReport(database(env))});
    if (path === '/api/prices/status') {
      if (!await verifyPriceJobBearer(request.headers.get('authorization') || '', env.PRICE_JOB_TOKEN)) return denied();
      const db = database(env);
      const [report, history, summary] = await Promise.all([
        readSweepReport(db), readSweepHistory(db), readPublicSweepReport(db),
      ]);
      return json({report, history, lastSuccessfulAt: summary?.lastSuccessfulAt ?? null});
    }
    if (path === '/api/prices/current') {
      const db = database(env);
      const [cycleReport, observations] = await Promise.all([readPublicSweepReport(db), readCatalogPriceDelta(db)]);
      const previous = cycleReport ? null : await db.prepare("SELECT error FROM source_health WHERE store='PRICE_IMPORTED_FEED'")
        .first<{error: string}>();
      const report = cycleReport ?? (previous ? JSON.parse(previous.error) as PublicSweepReport : null);
      if (!report) return json({report: null});
      let lastObservation = 0;
      const stores = new Map<PriceFeed['stores'][number]['store'], PriceFeed['stores'][number]>();
      for (const {offer} of observations) {
        if (!storeInfo(offer.store) || (offer.store === 'DNS' && (offer.status !== 'ok' || !(Number(offer.price) > 0)))) continue;
        lastObservation = Math.max(lastObservation, Date.parse(offer.checkedAt) || 0);
        let summary = stores.get(offer.store);
        if (!summary) {
          summary = {store: offer.store, updated: 0, requests: 0, failures: 0, review: 0};
          stores.set(offer.store, summary);
        }
        if (offer.status === 'ok' && offer.price !== null) summary.updated++;
      }
      const checkedAt = new Date(Math.max(
        Date.parse(report.checkedAt), Date.parse(report.lastSuccessfulAt ?? '') || 0, lastObservation,
      )).toISOString();
      return json({
        version: 1, region: 'Москва', source: 'd1',
        report: {...report, checkedAt}, observations, stores: [...stores.values()],
      } satisfies PriceFeed);
    }
  }

  if (path === '/api/prices/refresh' && request.method === 'POST') return denied();
  if (path !== '/api/prices/sweep') return json({error: 'Маршрут не найден'}, 404);
  if (request.method !== 'POST') return json({error: 'Метод недоступен'}, 405, {Allow: 'GET, POST'});
  if (!await verifyPriceJobBearer(request.headers.get('authorization') || '', env.PRICE_JOB_TOKEN)) return denied();
  const caller = request.headers.get('x-dz-price-trigger');
  const trigger = caller === 'github' || caller === 'cron' ? caller : 'manual';
  try {
    const result = await runPriceSweep(trigger, env);
    return json(result, result.report.status === 'blocked' || result.report.status === 'failed' ? 503 : 200);
  } catch (error) {
    if (error instanceof SweepIntervalError) {
      return json({error: error.message, retryAfter: error.retryAfter, reason: error.reason}, 429, {'Retry-After': String(error.retryAfter)});
    }
    if (trigger !== 'cron') await logSweepFailure(error, env, trigger);
    return json({error: 'Сервер обновления недоступен'}, 503);
  }
}

async function logSweepFailure(error: unknown, env: Cloudflare.Env, trigger: SweepReport['trigger']) {
  console.error('Ошибка обновления цен', priceSweepFailureMessage(error));
  try {
    await recordFailedSweep(error, trigger, env);
  } catch (writeError) {
    console.error('Не удалось записать ошибку в историю циклов', writeError);
  }
}

async function scheduledSweep(env: Cloudflare.Env) {
  try {
    if (!env.PRICE_JOB_TOKEN) throw new ScheduledSweepError('Не задан секрет PRICE_JOB_TOKEN.');
    const origin = new URL(env.PRICE_WORKER_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.workers.dev') || origin.username || origin.password) {
      throw new ScheduledSweepError('PRICE_WORKER_ORIGIN должен указывать на Worker по HTTPS.');
    }
    const endpoint = new URL('/api/prices/sweep', origin);
    const deadline = Date.now() + 13 * 60_000;
    // Each portion gets an independent Worker invocation and its own resource limits.
    for (let i = 0; i < 40 && Date.now() + 150_000 < deadline; i++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + env.PRICE_JOB_TOKEN, 'X-DZ-Price-Trigger': 'cron'},
        redirect: 'manual',
        signal: AbortSignal.timeout(150_000),
      });
      if (response.status === 429) {
        await response.body?.cancel();
        return;
      }
      const result = await response.json<Partial<CycleResult>>().catch(() => null);
      if (result?.done && result.report) {
        if (!result.skipped && result.report.updated === 0) {
          console.error('Плановый цикл не опубликовал цены', result.report.message);
        }
        return;
      }
      if (!response.ok || result?.done !== false) {
        throw new ScheduledSweepError('Порция планового цикла завершилась с HTTP ' + response.status + '. Курсор сохранён.');
      }
    }
    throw new ScheduledSweepError('Не хватило времени на все порции. Курсор сохранён для резервного запуска.');
  } catch (error) {
    await logSweepFailure(error, env, 'cron');
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/catalog' && request.method === 'GET') {
        return await catalogResponse(env.ASSETS!, url, snapshotById, await readCatalogPriceDelta(database(env)));
      }
      if (path.startsWith('/api/prices/')) return await servePrices(request, path, env);
      if (['/mcp', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(path)) {
        return new Response('Вход не требуется. Сборки сохраняются в этом браузере.', {status: 404});
      }
      if (path === '/api/builds' || path.startsWith('/api/builds/')) {
        return json({error: 'Сборки сохраняются только в браузере.'}, 404);
      }
      return env.ASSETS!.fetch(request);
    } catch (error) {
      console.error('Ошибка API DZ LAB', error);
      if (path === '/api/catalog') {
        const base = await env.ASSETS!.fetch(new Request(new URL('/api/catalog', url)));
        return new Response(base.body, {
          status: base.status,
          headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-DZ-Catalog': 'snapshot'},
        });
      }
      return json({error: 'Данные временно недоступны'}, 503);
    }
  },
  scheduled(_event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledSweep(env));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
