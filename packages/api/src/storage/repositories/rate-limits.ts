import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { RateLimitCounterKey, RateLimitReservation, RateLimitsRepository } from '../contracts.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { safeInteger, utcInstant } from '../conversion.ts';

/** Most rows one write deletes from each table. Later writes take the rest. */
const CLEANUP_BATCH = 500;
const later = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();

/**
 * Every write locks its counters by primary key in ascending key order, so overlapping counter sets
 * cannot deadlock. Cleanup runs last and skips rows other writes hold, so it never waits.
 */
export function createRateLimitRepository(db: Kysely<PhysicalDatabase>, backend: Backend): RateLimitsRepository {
  const server = backend !== 'sqlite';
  const mysql = backend === 'mysql' || backend === 'mariadb';
  function ordered<T extends RateLimitCounterKey>(counters: readonly T[]): T[] {
    const sorted = [...counters].sort((a, b) => (a.keyHash < b.keyHash ? -1 : a.keyHash > b.keyHash ? 1 : 0));
    if (sorted.some((counter, i) => i > 0 && counter.keyHash === sorted[i - 1]!.keyHash))
      throw new Error('Duplicate rate-limit counter');
    return sorted;
  }
  /** Creates the counter if missing, takes its row lock and clears an expired window. */
  async function lock(keyHash: string, now: string, windowMs: number): Promise<void> {
    const fresh = later(now, windowMs);
    // PostgreSQL's DO NOTHING skips a row that a concurrent cleanup has locked and then deletes, so
    // the update can find no row. Insert again until the update holds the row lock.
    for (;;) {
      const insert = db.insertInto('rate_limit_counters').values({ key_hash: keyHash, reset_at: fresh, failures: 0 });
      // A duplicate under ON DUPLICATE KEY UPDATE takes the exclusive row lock at once. INSERT IGNORE
      // would take a shared lock, and two writers upgrading it for the update below would deadlock.
      await (
        mysql
          ? insert.onDuplicateKeyUpdate({ key_hash: keyHash })
          : insert.onConflict(c => c.column('key_hash').doNothing())
      ).execute();
      // MySQL assigns left to right: failures must read reset_at before reset_at changes.
      const result = await db
        .updateTable('rate_limit_counters')
        .set({
          failures: sql<number>`case when ${sql.ref('reset_at')} <= ${now} then 0 else ${sql.ref('failures')} end`,
          reset_at: sql<string>`case when ${sql.ref('reset_at')} <= ${now} then ${fresh} else ${sql.ref('reset_at')} end`,
        })
        .where('key_hash', '=', keyHash)
        .executeTakeFirst();
      if (result.numUpdatedRows === 1n) return;
    }
  }
  /** The first failure of a window starts it, as after a reset. */
  async function addFailure(keyHash: string, now: string, windowMs: number): Promise<void> {
    await lock(keyHash, now, windowMs);
    await db
      .updateTable('rate_limit_counters')
      .set({
        reset_at: sql<string>`case when ${sql.ref('failures')} = 0 then ${later(now, windowMs)} else ${sql.ref('reset_at')} end`,
        failures: sql<number>`${sql.ref('failures')} + 1`,
      })
      .where('key_hash', '=', keyHash)
      .execute();
  }
  async function cleanup(now: string): Promise<void> {
    let reservations = db
      .selectFrom('rate_limit_reservations')
      .select('id')
      .where('expires_at', '<=', now)
      .limit(CLEANUP_BATCH);
    if (server) reservations = reservations.forUpdate().skipLocked();
    const expired = (await reservations.execute()).map(row => row.id);
    if (expired.length) await db.deleteFrom('rate_limit_reservations').where('id', 'in', expired).execute();
    // A reservation is only added under its counter's lock, so a locked idle counter stays idle.
    let counters = db
      .selectFrom('rate_limit_counters')
      .select('key_hash')
      .where('reset_at', '<=', now)
      .where(eb =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('rate_limit_reservations')
              .select('id')
              .whereRef('rate_limit_reservations.key_hash', '=', 'rate_limit_counters.key_hash')
              .where('expires_at', '>', now),
          ),
        ),
      )
      .limit(CLEANUP_BATCH);
    if (server) counters = counters.forUpdate().skipLocked();
    const idle = (await counters.execute()).map(row => row.key_hash);
    if (idle.length) await db.deleteFrom('rate_limit_counters').where('key_hash', 'in', idle).execute();
  }
  return {
    async reserve(counters, at, windowMs, leaseMs) {
      const now = utcInstant(at);
      const seen = new Map<string, { failures: number; resetAt: string; live: number }>();
      for (const { keyHash } of ordered(counters)) {
        await lock(keyHash, now, windowMs);
        const row = await db
          .selectFrom('rate_limit_counters')
          .select(eb => [
            'failures',
            'reset_at',
            eb
              .selectFrom('rate_limit_reservations')
              .select(e => e.fn.countAll().as('n'))
              .where('key_hash', '=', keyHash)
              .where('expires_at', '>', now)
              .as('live'),
          ])
          .where('key_hash', '=', keyHash)
          .executeTakeFirstOrThrow();
        seen.set(keyHash, {
          failures: safeInteger(row.failures),
          resetAt: utcInstant(row.reset_at),
          live: safeInteger(row.live),
        });
      }
      const current = counters.map(counter => ({ ...seen.get(counter.keyHash)!, limit: counter.limit }));
      const blocked = current.filter(counter => counter.failures >= counter.limit);
      let result: RateLimitReservation;
      if (blocked.length) result = { ok: false, reason: 'blocked', resetAts: blocked.map(counter => counter.resetAt) };
      else if (current.some(counter => counter.failures + counter.live >= counter.limit))
        result = { ok: false, reason: 'slots' };
      else {
        const rows = counters.map(({ keyHash }) => ({
          id: randomUUID(),
          key_hash: keyHash,
          expires_at: later(now, leaseMs),
        }));
        if (rows.length) await db.insertInto('rate_limit_reservations').values(rows).execute();
        result = { ok: true, reservations: rows.map(row => row.id) };
      }
      // A refusal keeps no idle counter, so refused attempts cannot fill the table with new keys.
      if (!result.ok) {
        await db
          .deleteFrom('rate_limit_counters')
          .where(
            'key_hash',
            'in',
            counters.map(counter => counter.keyHash),
          )
          .where('failures', '=', 0)
          .where(eb =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('rate_limit_reservations')
                  .select('id')
                  .whereRef('rate_limit_reservations.key_hash', '=', 'rate_limit_counters.key_hash')
                  .where('expires_at', '>', now),
              ),
            ),
          )
          .execute();
      }
      await cleanup(now);
      return result;
    },
    async release(reservations, counters, failed, at, windowMs) {
      const now = utcInstant(at);
      if (reservations.length)
        await db
          .deleteFrom('rate_limit_reservations')
          .where('id', 'in', [...reservations])
          .execute();
      if (failed) for (const { keyHash } of ordered(counters)) await addFailure(keyHash, now, windowMs);
      await cleanup(now);
    },
    async reset(keyHashes, at) {
      const now = utcInstant(at);
      // Ending the window now lets cleanup drop the counter once no reservation holds it.
      for (const { keyHash } of ordered([...new Set(keyHashes)].map(keyHash => ({ keyHash })))) {
        await db
          .updateTable('rate_limit_counters')
          .set({ failures: 0, reset_at: now })
          .where('key_hash', '=', keyHash)
          .execute();
      }
      await cleanup(now);
    },
  };
}
