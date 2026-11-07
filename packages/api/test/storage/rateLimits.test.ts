import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { RateLimitCounter, RateLimitsRepository } from '../../src/storage/contracts.ts';
import { createStorage } from '../fixtures/storageShortcuts.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { disposableBackend } from './support/disposableBackend.ts';

const WINDOW = 15 * 60 * 1000;
const LEASE = 60 * 1000;
const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const hash = (name: string) => createHash('sha256').update(name).digest('hex');
const counter = (name: string, limit: number): RateLimitCounter => ({ keyHash: hash(name), limit });

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: rate-limit counters and reservations are shared and atomic`, { timeout: 240000 }, async t => {
    const fixture = await disposableBackend(backend);
    try {
      const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 10 };
      const connection = await initializeDatabase(config);
      const runner = createTransactionRunner(connection, db => createAccountRepositories(db, backend));
      const limits = <T>(work: (repository: RateLimitsRepository) => Promise<T>) =>
        runner.transaction(r => work(r.rateLimits));
      const reserve = (counters: RateLimitCounter[], now: string, leaseMs = LEASE, windowMs = WINDOW) =>
        limits(r => r.reserve(counters, now, windowMs, leaseMs));
      /** Failed checks: each reserves, then releases with a failure. */
      const fail = async (counters: RateLimitCounter[], now: string, times = 1) => {
        for (let i = 0; i < times; i++) {
          const held = await reserve(counters, now);
          assert.ok(held.ok, 'a failing check gets its slots');
          await limits(r => r.release(held.reservations, counters, true, now, WINDOW));
        }
      };
      const live = async (c: RateLimitCounter) =>
        (
          await connection.db
            .selectFrom('rate_limit_reservations')
            .select('id')
            .where('key_hash', '=', c.keyHash)
            .execute()
        ).length;
      const counterRow = (c: RateLimitCounter) =>
        connection.db
          .selectFrom('rate_limit_counters')
          .selectAll()
          .where('key_hash', '=', c.keyHash)
          .executeTakeFirst();
      try {
        await t.test('parallel reservations on one counter never exceed its limit', async () => {
          const one = counter('parallel', 10);
          const results = await Promise.all(Array.from({ length: 30 }, () => reserve([one], at(0))));
          const granted = results.flatMap(result => (result.ok ? result.reservations : []));
          assert.equal(granted.length, 10);
          assert.deepEqual(
            new Set(results.filter(result => !result.ok).map(result => (result.ok ? '' : result.reason))),
            new Set(['slots']),
          );
          assert.equal(await live(one), 10);
          await Promise.all(granted.map(id => limits(r => r.release([id], [one], false, at(1), WINDOW))));
          assert.equal(await live(one), 0);
          assert.equal(Number((await counterRow(one))!.failures), 0);
        });

        await t.test('overlapping counter sets reserved in parallel do not deadlock', async () => {
          const shared = counter('account', 1000),
            a = counter('address-a', 1000),
            b = counter('address-b', 1000);
          const sets = [
            [shared, a],
            [b, shared],
            [a, b],
            [b, a, shared],
            [shared, b, a],
          ];
          const chosen = Array.from({ length: 40 }, (_, i) => sets[i % sets.length]!);
          const results = await Promise.all(chosen.map(set => reserve(set, at(1000))));
          assert.ok(results.every(result => result.ok));
          const reserved = (c: RateLimitCounter) => chosen.filter(set => set.includes(c)).length;
          for (const c of [shared, a, b]) assert.equal(await live(c), reserved(c));
          // Every failed check charges all its counters in one write.
          await Promise.all(
            results.map((result, i) =>
              limits(r => r.release(result.ok ? result.reservations : [], chosen[i]!, true, at(2000), WINDOW)),
            ),
          );
          for (const c of [shared, a, b]) {
            assert.equal(await live(c), 0);
            assert.equal(Number((await counterRow(c))!.failures), reserved(c));
          }
        });

        await t.test('a full counter refuses as blocked; failures plus live reservations refuse as slots', async () => {
          const full = counter('full', 10),
            other = counter('other', 10);
          await fail([full], at(10_000), 9);
          await fail([full], at(20_000));
          assert.deepEqual(await reserve([other, full], at(30_000)), {
            ok: false,
            reason: 'blocked',
            resetAts: [at(10_000 + WINDOW)],
          });
          assert.equal(await live(other), 0, 'a refused reservation reserves nothing');
          assert.equal(await counterRow(other), undefined, 'and keeps no counter it created');

          const slots = counter('slots', 3);
          await fail([slots], at(30_000));
          assert.equal((await reserve([slots], at(30_000))).ok, true);
          assert.equal((await reserve([slots], at(30_000))).ok, true);
          assert.deepEqual(await reserve([slots, other], at(30_000)), { ok: false, reason: 'slots' });
          assert.equal(await live(other), 0, 'all-or-none');
          assert.ok(await counterRow(slots), 'a refusal keeps counters with failures or live reservations');

          // An expired lease stops counting, and an expired window starts with no failures.
          assert.equal((await reserve([slots], at(30_000 + LEASE))).ok, true);
          assert.deepEqual(await reserve([full], at(10_000 + WINDOW - 1)), {
            ok: false,
            reason: 'blocked',
            resetAts: [at(10_000 + WINDOW)],
          });
          const fresh = await reserve([full], at(10_000 + WINDOW));
          assert.equal(fresh.ok, true);
          const row = (await counterRow(full))!;
          assert.equal(Number(row.failures), 0);
          assert.equal(row.reset_at, at(10_000 + 2 * WINDOW));
          // The first failure of a window starts it.
          await fail([full], at(20_000 + WINDOW));
          assert.equal((await counterRow(full))!.reset_at, at(20_000 + 2 * WINDOW));
        });

        await t.test('reset clears failures and keeps reservations', async () => {
          const pair = counter('reset', 2);
          const held = await reserve([pair], at(3 * WINDOW));
          assert.equal(held.ok, true);
          await fail([pair], at(3 * WINDOW));
          assert.deepEqual(await reserve([pair], at(3 * WINDOW)), { ok: false, reason: 'slots' });
          await limits(r => r.reset([pair.keyHash], at(3 * WINDOW)));
          assert.equal(await live(pair), 1);
          assert.equal((await reserve([pair], at(3 * WINDOW))).ok, true);
          assert.deepEqual(await reserve([pair], at(3 * WINDOW)), { ok: false, reason: 'slots' });
        });

        await t.test('writes delete expired reservations and idle expired counters', async () => {
          // A lease that outlives its window keeps the counter until the lease ends.
          const leased = counter('leased', 5);
          assert.equal((await reserve([leased], at(5 * WINDOW), 2 * WINDOW)).ok, true);
          await fail([counter('tick-1', 5)], at(6 * WINDOW));
          assert.ok(await counterRow(leased));
          assert.equal(await live(leased), 1);
          await fail([counter('tick-2', 5)], at(7 * WINDOW));
          const counters = (await connection.db.selectFrom('rate_limit_counters').select('key_hash').execute()).map(
            row => row.key_hash,
          );
          assert.deepEqual(counters, [hash('tick-2')]);
          assert.equal((await connection.db.selectFrom('rate_limit_reservations').select('id').execute()).length, 0);
        });

        await t.test('counters survive closing and reopening storage', async () => {
          const durable = counter('durable', 3);
          await fail([durable], at(8 * WINDOW), 3);
        });
      } finally {
        await connection.close();
      }

      const reopened = createStorage(await initializeDatabase(config));
      try {
        const durable = counter('durable', 3);
        assert.deepEqual(await reopened.rateLimits.reserve([durable], at(8 * WINDOW + 1), WINDOW, LEASE), {
          ok: false,
          reason: 'blocked',
          resetAts: [at(9 * WINDOW)],
        });
        await reopened.rateLimits.reset([durable.keyHash], at(8 * WINDOW + 2));
        assert.equal((await reopened.rateLimits.reserve([durable], at(8 * WINDOW + 2), WINDOW, LEASE)).ok, true);
      } finally {
        await reopened.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
