import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, type Kysely } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { StorageConflict, StorageTransactionError } from '../../src/storage/errors.ts';
import { disposableBackend } from './support/disposableBackend.ts';

function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const instant = '2026-01-01T00:00:00.000Z';
function repos(db: Kysely<PhysicalDatabase>, backend: string) {
  const connectionId = async () => {
    const query = backend === 'postgres' ? 'select pg_backend_pid() as id' : backend === 'sqlite' ? 'select 1 as id' : 'select connection_id() as id';
    return String((await sql.raw<{ id: number }>(query).execute(db)).rows[0]!.id);
  };
  return {
    users: {
      connectionId,
      async add(id: number) { await db.insertInto('users').values({ id, email: `u${id}@example.test`, api_token: `token${id}`, password_hash: 'hash', created_at: instant, updated_at: instant, default_workspace_id: null, disabled_at: null, role: 'admin' }).execute(); },
      async name(id: number) { return (await db.selectFrom('users').select('fullname').where('id', '=', id).executeTakeFirstOrThrow()).fullname; },
      async rename(id: number, fullname: string) { await db.updateTable('users').set({ fullname }).where('id', '=', id).execute(); },
      async count() { return Number((await db.selectFrom('users').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n); },
      async admins() { return Number((await db.selectFrom('users').select(db.fn.countAll().as('n')).where('role', '=', 'admin').executeTakeFirstOrThrow()).n); },
      async demote(id: number) { await db.updateTable('users').set({ role: 'user' }).where('id', '=', id).execute(); },
    },
    timers: {
      connectionId,
      async absent(id: number) {
        assert.equal((await db.selectFrom('timer_states').selectAll().where('user_id', '=', id).execute()).length, 0);
        return !(await db.selectFrom('time_entries').select('id').where('user_id', '=', id).where('stop', 'is', null).executeTakeFirst());
      },
      async start(id: number) { await db.insertInto('time_entries').values({ user_id: id, workspace_id: 1, start: instant, stop: null, project_id: null, task_id: null, created_at: instant, updated_at: instant, deleted_at: null }).execute(); },
    },
    tokens: {
      async consume() { return (await db.updateTable('account_tokens').set({ used_at: instant }).where('id', '=', 1).where('used_at', 'is', null).where('expires_at', '>', instant).executeTakeFirstOrThrow()).numUpdatedRows === 1n; },
    },
  };
}
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: independent operations, guards, retry policy and snapshots`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const c = await initializeDatabase(fixture.config);
    const other = await openConnection<PhysicalDatabase>(fixture.config);
    const factory = (db: Kysely<PhysicalDatabase>) => repos(db, backend);
    const runner = createTransactionRunner(c, factory);
    const second = createTransactionRunner(other, factory);
    try {
      console.log(`${backend} transaction version:`, (await sql.raw(backend === 'sqlite' ? 'select sqlite_version() as v' : 'select version() as v').execute(c.db)).rows[0]);
      await t.test('instance guard protects first setup before a user exists', async () => {
        let created = 0;
        await Promise.all([runner, second].map((r, index) => r.transaction(async ctx => {
          await ctx.lockInstanceAdministration();
          if (await ctx.users.count() === 0) { await delay(15); await ctx.users.add(index + 1); created++; }
        })));
        assert.equal(created, 1);
      });
      await c.db.deleteFrom('users').execute();
      await runner.transaction(async ctx => { for (const id of [1, 2, 3]) await ctx.users.add(id); });
      for (const id of [1, 2]) await c.db.insertInto('workspaces').values({ id, name: `w${id}`, created_at: instant, updated_at: instant, default_hourly_rate: null }).execute();

      await t.test('overlapping independent contexts cannot share writes or hooks', async () => {
        const entered = gate(), release = gate();
        let otherEntered = false;
        const a = runner.transaction(async ctx => {
          await ctx.users.rename(1, 'rolled back');
          entered.resolve(); await release.promise;
          throw new Error('outer rollback');
        });
        const rejected = assert.rejects(a, /outer rollback/);
        await entered.promise;
        const b = second.transaction(async ctx => { otherEntered = true; await ctx.users.rename(2, 'independent'); });
        try {
          if (backend !== 'sqlite') { await b; assert.equal(otherEntered, true); }
          else { await delay(20); assert.equal(otherEntered, false); }
        } finally { release.resolve(); }
        await Promise.all([rejected, b]);
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), '');
        assert.equal(await runner.readSnapshot(r => r.users.name(2)), 'independent');
      });
      await t.test('one pool queues or isolates overlapping async owners', async () => {
        const seen: number[] = [];
        const identities = new Set<string>();
        await Promise.all([1, 2, 3].map(id => runner.transaction(async ctx => {
          const identity = await ctx.users.connectionId();
          identities.add(identity);
          assert.equal(await ctx.timers.connectionId(), identity);
          await ctx.users.rename(id, `owner${id}`); await delay(5);
          assert.equal(await ctx.users.connectionId(), identity); assert.equal(await ctx.users.name(id), `owner${id}`); seen.push(id);
        })));
        assert.deepEqual([...seen].sort(), [1, 2, 3]);
        if (backend !== 'sqlite') assert.equal(identities.size, 3);
      });
      if (backend === 'sqlite') await t.test('busy immediate acquisition is bounded, safe and restores the connection timeout', async () => {
        const entered = gate(), release = gate(); let enteredContender = 0;
        const previousTimeout = (await sql<{ timeout: number }>`PRAGMA busy_timeout`.execute(other.db)).rows[0]!.timeout;
        await sql`PRAGMA busy_timeout = 25`.execute(other.db);
        const holder = runner.transaction(async () => { entered.resolve(); await release.promise; });
        await entered.promise;
        try {
          await assert.rejects(second.transaction(async () => { enteredContender++; }),
            (e: unknown) => e instanceof StorageConflict && e.kind === 'busy');
          assert.equal(enteredContender, 0);
          assert.equal((await sql<{ timeout: number }>`PRAGMA busy_timeout`.execute(other.db)).rows[0]!.timeout, 25);
        } finally { release.resolve(); await holder; }
        await second.transaction(async ctx => { await ctx.users.name(1); });
        await sql.raw(`PRAGMA busy_timeout = ${previousTimeout}`).execute(other.db);
      });
      await t.test('parent-user guard serializes absent timer reads on independent connections', async () => {
        const entered = gate(), release = gate();
        let readSecond = false, starts = 0;
        const a = runner.transaction(async ctx => {
          await ctx.lockUserTimer(1); assert.equal(await ctx.timers.absent(1), true); entered.resolve(); await release.promise;
          await ctx.timers.start(1); starts++;
        });
        await entered.promise;
        const b = second.transaction(async ctx => { await ctx.lockUserTimer(1); readSecond = true; if (await ctx.timers.absent(1)) { await ctx.timers.start(1); starts++; } });
        try { await delay(30); assert.equal(readSecond, false); } finally { release.resolve(); }
        await Promise.all([a, b]); assert.equal(starts, 1);
      });
      await t.test('instance guard protects the last admin and releases after errors', async () => {
        await c.db.updateTable('users').set({ role: 'user' }).where('id', '=', 3).execute();
        const outcomes = await Promise.all([runner, second].map((r, i) => r.transaction(async ctx => {
          await ctx.lockInstanceAdministration();
          if (await ctx.users.admins() <= 1) return false;
          await delay(15); await ctx.users.demote(i + 1); return true;
        })));
        assert.deepEqual(outcomes.sort(), [false, true]);
        await assert.rejects(runner.transaction(async ctx => { await ctx.lockInstanceAdministration(); throw new Error('abort'); }));
        await second.transaction(async ctx => { await ctx.lockInstanceAdministration(); assert.equal(await ctx.users.admins(), 1); });
      });
      await t.test('deterministic workspace/user lock order and savepoint lock restoration', async () => {
        await Promise.all([runner, second].map(r => r.transaction(async ctx => {
          await ctx.lockWorkspaces([2, 1, 2]); await ctx.lockUsers([3, 1, 2]); await ctx.lockUserTimer(1);
        })));
        await assert.rejects(runner.transaction(async ctx => { await ctx.lockUsers([2]); await ctx.lockUsers([1]); }), /lock order/);
        await runner.transaction(async ctx => {
          await assert.rejects(ctx.savepoint(async sp => { await sp.lockUsers([3]); throw new Error('undo'); }));
          await assert.rejects(ctx.lockWorkspaces([1]), /lock order/);
          await ctx.lockUsers([3]);
        });
      });
      await t.test('conditional one-time token consumption has exactly one winner', async () => {
        await c.db.insertInto('account_tokens').values({ id: 1, token_hash: 'hash', kind: 'password_reset', role: null, note: null, user_id: 1, created_by: null, created_at: instant, expires_at: '2027-01-01T00:00:00.000Z', used_at: null }).execute();
        const outcomes = await Promise.all([runner, second].map(r => r.transaction(ctx => ctx.tokens.consume())));
        assert.deepEqual(outcomes.sort(), [false, true]);
      });
      await t.test('repeatable read snapshot survives an independent committed write and rejects writes', async () => {
        await runner.readSnapshot(async r => {
          const name = await r.users.name(1);
          await second.transaction(ctx => ctx.users.rename(1, 'after snapshot'));
          assert.equal(await r.users.name(1), name);
        });
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), 'after snapshot');
        await assert.rejects(runner.readSnapshot(r => r.users.rename(1, 'forbidden')));
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), 'after snapshot');
      });
      if (backend !== 'sqlite') await t.test('real deadlock retries a rolled-back victim and publishes each operation once', async () => {
        const reached = [gate(), gate()]; const counts = [0, 0]; const published: number[] = [];
        await Promise.all([runner, second].map((r, index) => r.transaction(async ctx => {
          counts[index]!++;
          const first = index + 1, next = 2 - index;
          await ctx.users.rename(first, `attempt${counts[index]}`);
          if (counts[index] === 1) { reached[index]!.resolve(); await reached[1 - index]!.promise; }
          await ctx.users.rename(next, 'deadlock recovered');
          ctx.afterCommit(async () => { published.push(index); });
        }, { maxAttempts: 2 })));
        assert.deepEqual(counts.slice().sort(), [1, 2]); assert.deepEqual(published.sort(), [0, 1]);
      });
      if (backend !== 'sqlite') await t.test('one-attempt policy exposes a real deadlock without retrying', async () => {
        const reached = [gate(), gate()]; const counts = [0, 0]; let published = 0;
        const results = await Promise.allSettled([runner, second].map((r, index) => r.transaction(async ctx => {
          counts[index]!++;
          await ctx.users.rename(index + 1, 'bounded');
          reached[index]!.resolve(); await reached[1 - index]!.promise;
          await ctx.users.rename(2 - index, 'winner');
          ctx.afterCommit(async () => { published++; });
        }, { maxAttempts: 1 })));
        assert.deepEqual(counts, [1, 1]); assert.equal(published, 1);
        const failed = results.filter(r => r.status === 'rejected');
        assert.equal(failed.length, 1);
        assert.ok(failed[0]!.reason instanceof StorageConflict && failed[0]!.reason.kind === 'deadlock');
      });
      if (backend === 'postgres') await t.test('real serializable snapshot conflict retries after confirmed rollback', async () => {
        // Force the engine's stronger isolation to exercise SQLSTATE 40001, independently of deadlocks.
        const serial = { ...c, db: c.db.withPlugin({
          transformQuery(args) {
            if (args.node.kind === 'RawNode' && args.node.sqlFragments[0] === 'BEGIN ISOLATION LEVEL READ COMMITTED') {
              return { ...args.node, sqlFragments: ['BEGIN ISOLATION LEVEL SERIALIZABLE'] };
            }
            return args.node;
          },
          async transformResult(args) { return args.result; },
        }) };
        const r = createTransactionRunner(serial, factory), reached = [gate(), gate()], counts = [0, 0];
        let published = 0;
        await Promise.all([0, 1].map(index => r.transaction(async ctx => {
          counts[index]!++; await ctx.users.name(3);
          if (counts[index] === 1) { reached[index]!.resolve(); await reached[1 - index]!.promise; }
          await ctx.users.rename(3, `serial${index}`);
          ctx.afterCommit(async () => { published++; });
        }, { maxAttempts: 2 })));
        assert.deepEqual(counts.sort(), [1, 2]); assert.equal(published, 2);
      });
      if (backend === 'postgres') await t.test('swallowed PostgreSQL constraint errors cannot publish an aborted commit', async () => {
        const previous = await runner.readSnapshot(r => r.users.name(1));
        let published = 0;
        await assert.rejects(runner.transaction(async ctx => {
          await ctx.users.rename(1, 'aborted');
          try { await ctx.users.add(1); } catch { /* deliberately forget the required savepoint */ }
          ctx.afterCommit(async () => { published++; });
        }), StorageTransactionError);
        assert.equal(published, 0);
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), previous);
      });
      await t.test('ambiguous commit acknowledgement never retries or publishes', async () => {
        let attempts = 0, published = 0;
        const uncertain = { ...c, db: c.db.withPlugin({
          transformQuery(args) { return args.node; },
          async transformResult(args) {
            if (attempts && (args.result as { rows: unknown[] }).rows.length === 0 && armed) { armed = false; throw Object.assign(new Error('lost commit response'), { code: '40001', errno: 1213 }); }
            return args.result;
          },
        }) };
        let armed = false;
        await assert.rejects(createTransactionRunner(uncertain, factory).transaction(async ctx => {
          attempts++; await ctx.users.rename(1, 'committed uncertain'); ctx.afterCommit(async () => { published++; }); armed = true;
        }), (e: unknown) => e instanceof StorageTransactionError && e.outcome === 'unknown');
        assert.equal(attempts, 1); assert.equal(published, 0);
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), 'committed uncertain');
      });
      await t.test('uncertain rollback acknowledgement never retries or publishes', async () => {
        let attempts = 0, published = 0, armed = false;
        const uncertain = { ...c, db: c.db.withPlugin({
          transformQuery(args) { return args.node; },
          async transformResult(args) {
            if (armed) { armed = false; throw Object.assign(new Error('lost rollback response'), { code: '40001', errno: 1213 }); }
            return args.result;
          },
        }) };
        const previous = await runner.readSnapshot(r => r.users.name(1));
        await assert.rejects(createTransactionRunner(uncertain, factory).transaction(async ctx => {
          attempts++; await ctx.users.rename(1, 'must roll back');
          ctx.afterCommit(async () => { published++; });
          armed = true; throw Object.assign(new Error('force retry candidate'), { code: '40001', errno: 1213 });
        }), (e: unknown) => e instanceof StorageTransactionError && e.outcome === 'unknown');
        assert.equal(attempts, 1); assert.equal(published, 0);
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), previous);
      });
      await t.test('conflicts are neutral and dry runs discard all effects', async () => {
        let publications = 0;
        await assert.rejects(runner.transaction(ctx => ctx.users.add(1)), (e: unknown) => e instanceof StorageConflict && e.kind === 'unique' && !e.message.includes('@'));
        await assert.rejects(runner.transaction(ctx => ctx.timers.start(9999)), (e: unknown) => e instanceof StorageConflict && e.kind === 'foreign-key');
        const original = await runner.readSnapshot(r => r.users.name(1));
        await runner.transaction(async ctx => {
          await ctx.users.rename(1, 'dry run'); ctx.afterCommit(async () => { publications++; });
          ctx.beforeCommit('async', async () => { await ctx.users.rename(1, 'settled dry run'); });
        }, { dryRun: true });
        assert.equal(await runner.readSnapshot(r => r.users.name(1)), original); assert.equal(publications, 0);
      });
    } finally { await other.close(); await c.close(); await fixture.cleanup(); }
  });
}
