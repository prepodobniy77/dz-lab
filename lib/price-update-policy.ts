export const DEFAULT_MIN_SWEEP_INTERVAL_MINUTES=660;
export const SWEEP_DEADLINE_MS=120_000;
export const MAX_AI_PRODUCTS_PER_RUN=50;
export const SWEEP_HOUR_UTC=3;
export const SWEEP_CRON_UTC=`0 ${SWEEP_HOUR_UTC} * * *`;
export const SWEEP_DAY_MS=86_400_000;
export function currentSweepWindowStart(now: number) {
  const date = new Date(now);
  const slot = Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),SWEEP_HOUR_UTC);
  return slot <= now ? slot : slot-SWEEP_DAY_MS;
}
export function isInCurrentSweepWindow(at: number, now: number) {
  return at >= currentSweepWindowStart(now) && at <= now;
}
export function minSweepIntervalMinutes(value:unknown){const minutes=Number(value);return Number.isFinite(minutes)&&minutes>=1?Math.min(10080,Math.floor(minutes)):DEFAULT_MIN_SWEEP_INTERVAL_MINUTES}
export function aiProductLimit(value:unknown){const limit=Number(value);return Number.isFinite(limit)&&limit>=10?Math.min(MAX_AI_PRODUCTS_PER_RUN,Math.floor(limit)):MAX_AI_PRODUCTS_PER_RUN}
