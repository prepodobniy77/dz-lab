import {SweepIntervalError} from './price-job-errors.ts';

const leaseKey = 'PRICE_CYCLE_LEASE';
const leaseSeconds = 180;

export async function acquirePriceLease(db: D1Database, now = Date.now()) {
  const token = crypto.randomUUID();
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + leaseSeconds * 1000).toISOString();
  const result = await db.prepare(`
    INSERT INTO source_health(store,checked_at,blocked_until,error) VALUES (?,?,?,?)
    ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,
      blocked_until=excluded.blocked_until,error=excluded.error
    WHERE source_health.blocked_until IS NULL OR source_health.blocked_until<=excluded.checked_at
  `).bind(leaseKey,startedAt,expiresAt,token).run();
  if (!result.meta.changes) {
    const row = await db.prepare('SELECT blocked_until FROM source_health WHERE store=?')
      .bind(leaseKey).first<{blocked_until:string|null}>();
    throw new SweepIntervalError(Math.max(1,(Date.parse(row?.blocked_until ?? '')-now)/1000) || leaseSeconds,'active_portion');
  }
  return async () => {
    await db.prepare('UPDATE source_health SET blocked_until=NULL WHERE store=? AND error=?').bind(leaseKey,token).run();
  };
}
