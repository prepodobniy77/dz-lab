import {appendFile} from 'node:fs/promises';
import type {CycleResult} from '../lib/price-cycle.ts';
import type {PublicSweepReport} from '../lib/price-status.ts';

const origin = process.env.SITE_URL;
const token = process.env.PRICE_JOB_TOKEN;
if (!origin || !token) throw new Error('Задай SITE_URL и PRICE_JOB_TOKEN.');
const url = new URL(origin);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('SITE_URL должен быть адресом сайта HTTPS без пути и параметров.');
}

const endpoint = new URL('/api/prices/sweep', url);
const statusResponse = await fetch(endpoint, {redirect: 'error', signal: AbortSignal.timeout(15_000)});
if (!statusResponse.ok) throw new Error('Статус недоступен, HTTP ' + statusResponse.status);
const {report} = await statusResponse.json() as {report?: PublicSweepReport | null};
if (report === undefined) throw new Error('Worker вернул неизвестный формат статуса.');

async function summary(message: string) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}

const successfulAt = Date.parse(report?.lastSuccessfulAt ?? '');
const age = Date.now() - successfulAt;
if (age >= 0 && age < 6 * 3600_000) {
  await summary('Запуск пропущен. Последний успешный цикл — ' + report!.lastSuccessfulAt);
} else {
  const maxPortions = 240;
  const deadline = Date.now() + 32 * 60_000;
  let done = false;
  for (let i = 1; i <= maxPortions && Date.now() + 150_000 < deadline; i++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + token, 'X-DZ-Price-Trigger': 'github'},
      redirect: 'error',
      signal: AbortSignal.timeout(150_000),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      await summary('Цикл выполняется или действует защитный интервал. Worker вернул HTTP 429.');
      done = true;
      break;
    }
    const result = await response.json() as Partial<CycleResult>;
    if (typeof result.done !== 'boolean') throw new Error('Обновитель вернул HTTP ' + response.status);
    console.log('Порция', i, 'обработано', result.processed ?? 0, 'завершено', result.done);
    if (result.done && result.report) {
      const run = result.report;
      await summary('Цикл ' + (run.cycleId ?? 'без ID') + ' · ' + run.status + ' · обновлено цен ' + (run.updatedOffers ?? run.updated) +
        ' · ' + (run.finishedAt ?? run.checkedAt) + (result.skipped ? ' · запуск пропущен' : ''));
      if (!result.skipped && (!response.ok || !run.cycleCompleted || !run.updated)) process.exitCode = 1;
      done = true;
      break;
    }
    if (!response.ok) throw new Error('Обновитель вернул HTTP ' + response.status);
  }
  if (!done) throw new Error('Исчерпан лимит времени или порций. Курсор сохранён для следующего запуска.');
}
