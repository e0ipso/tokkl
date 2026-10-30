import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { StorageConflict } from '../../src/storage/errors.ts';
import * as entries from '../../src/domain/timeEntries.ts';
import * as catalog from '../../src/domain/catalogs.ts';
import { createTimerOperations, createTimerPublication, createCatalogTimerEffects, touchTimer } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount, entryAt as at } from './support/entry-timer.ts';
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; }
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: real entry/timer races, late settlement and publication isolation`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 };
    const connection = await initializeDatabase(config), other = await openConnection<PhysicalDatabase>(config);
    const factory = entryTimerFactory(backend);
    let failed = 0;
    const runner = createTransactionRunner(connection, factory, { publicationFailed: async () => { failed++; } });
    const second = createTransactionRunner(other, factory);
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('races'))), wid = user.defaultWorkspaceId;
      const revisions: number[] = [];
      const publish = createTimerPublication(async (id, state) => {
        const stored = await runner.readSnapshot(ctx => ctx.timers.getRevision(id));
        assert.ok(stored && stored.revision >= state.revision); revisions.push(state.revision);
      });
      const timers = [runner, second].map(r => createTimerOperations(r, publish));
      await t.test('absent state races on separate connections produce one session and a 409', async () => {
        assert.equal(await runner.readSnapshot(ctx => ctx.timers.getRevision(user.id)), undefined);
        const held = gate(), release = gate();
        const holder = runner.transaction(async ctx => { await ctx.lockWorkspaces([wid]); await ctx.lockUserTimer(user.id);
          assert.equal(await ctx.timers.getRevision(user.id), undefined); held.resolve(); await release.promise; });
        await held.promise; let completed = false;
        const first = timers[1]!.startPomodoro(user.id, {}, at('09:00:00')).finally(() => { completed = true; });
        try { await delay(30); assert.equal(completed, false); } finally { release.resolve(); }
        await holder;
        const outcomes = await Promise.allSettled([first, timers[0]!.startPomodoro(user.id, {}, at('09:00:01'))]);
        assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
        const refusal = outcomes.find(o => o.status === 'rejected'); assert.equal(refusal?.status === 'rejected' && refusal.reason.status, 409);
        const state = await timers[0]!.getTimerState(user.id);
        assert.equal(state.revision, 1); assert.equal(state.pomodoro?.entry_id, state.running_entry?.id);
        assert.equal((await runner.readSnapshot(ctx => ctx.entries.list(user.id))).filter(e => e.stop === null).length, 1);
      });
      await t.test('concurrent stale phase confirmation has one winner', async () => {
        const before = await timers[0]!.getTimerState(user.id);
        const outcomes = await Promise.allSettled(timers.map(timer => timer.nextPomodoroPhase(user.id, before.revision, at('09:05:00'))));
        assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
        const refusal = outcomes.find(o => o.status === 'rejected'); assert.equal(refusal?.status === 'rejected' && refusal.reason.status, 409);
        assert.equal((await timers[0]!.getTimerState(user.id)).revision, before.revision + 1);
      });
      await t.test('returned state includes mutations made by later before-commit hooks', async () => {
        const wrapper = {
          readSnapshot: runner.readSnapshot,
          transaction<T>(work: Parameters<typeof runner.transaction<T>>[0]) {
            return runner.transaction(async ctx => {
              const result = await work(ctx);
              ctx.beforeCommit('late-entry-edit', async () => {
                const e = (await ctx.entries.running(user.id))!;
                await entries.updateTimeEntry(ctx, user, wid, e.id, { description: 'late committed edit' }, publish);
              });
              return result;
            });
          },
        };
        const late = createTimerOperations(wrapper, publish);
        const state = await late.getTimerState(user.id, at('09:06:00'));
        assert.equal(state.running_entry?.description, 'late committed edit');
        assert.deepEqual(state, await timers[0]!.getTimerState(user.id, at('09:06:00')));
      });
      await t.test('failed publication leaves committed state successful and later subscribers work after release', async () => {
        const before = await timers[0]!.getTimerState(user.id);
        const broken = createTimerPublication(async (id, state) => {
          assert.equal((await runner.readSnapshot(ctx => ctx.timers.getRevision(id)))?.revision, state.revision);
          throw new Error('subscriber failure');
        });
        const timer = createTimerOperations(runner, broken);
        const state = await timer.endPomodoro(user.id, before.revision, at('09:10:00'));
        assert.equal(failed, 1); assert.equal(state.running_entry, null);
        assert.equal((await timers[0]!.getTimerState(user.id)).revision, state.revision);
      });
      await t.test('rolled back attempts and dry runs publish nothing, retry publishes once', async () => {
        const count = revisions.length;
        const dry = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('10:00:00').toISOString() }, publish), { dryRun: true });
        assert.equal(await runner.readSnapshot(ctx => ctx.entries.get(user.id, dry.id)), undefined); assert.equal(revisions.length, count);
        let attempts = 0;
        await runner.transaction(async ctx => {
          await entries.createTimeEntry(ctx, user, wid, { start: at('11:00:00').toISOString() }, publish);
          if (++attempts === 1) throw new StorageConflict('serialization');
        });
        assert.equal(attempts, 2); assert.equal(revisions.length, count + 1);
        assert.deepEqual(revisions, [...new Set(revisions)].sort((a,b) => a-b));
      });
      await t.test('cross-workspace entry starts recheck discovery after the parent guard', async () => {
        const owner = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('cross')));
        const wid2 = await runner.transaction(async ctx => {
          const w = await ctx.workspaces.create('Second'); await ctx.workspaces.addMember({ workspaceId: w.id, userId: owner.id, role: 'member' }); return w.id;
        });
        const guardConnection = await openConnection<PhysicalDatabase>(config), guard = createTransactionRunner(guardConnection, factory);
        try {
          const held = gate(), release = gate();
          const holder = guard.transaction(async ctx => { await ctx.lockUserTimer(owner.id); held.resolve(); await release.promise; });
          await held.promise;
          const starts = [runner, second].map((r, i) => r.transaction(ctx => entries.createTimeEntry(ctx, owner, i ? wid2 : owner.defaultWorkspaceId,
            { start: at(i ? '14:10:00' : '14:00:00').toISOString() }, publish)));
          try { await delay(40); } finally { release.resolve(); }
          await holder;
          const results = await Promise.all(starts); assert.equal(results.length, 2);
          const rows = await runner.readSnapshot(ctx => ctx.entries.list(owner.id));
          assert.equal(rows.filter(e => e.stop === null).length, 1);
          assert.equal((await runner.readSnapshot(ctx => ctx.timers.getRevision(owner.id)))?.revision, 2);
        } finally { await guardConnection.close(); }
      });
      await t.test('publication callback serializes a user and suppresses overtaken snapshots', async () => {
        const held = gate(), release = gate(), states: number[] = [];
        const p = createTimerPublication(async (_id, state) => { states.push(state.revision); if (states.length === 1) { held.resolve(); await release.promise; } });
        const state = await timers[0]!.getTimerState(user.id);
        const a = p(user.id, { ...state, revision: 30 }); await held.promise;
        const b = p(user.id, { ...state, revision: 32 }), c = p(user.id, { ...state, revision: 31 });
        release.resolve(); await Promise.all([a,b,c]); assert.deepEqual(states, [30,32]);
        p.forgetUser(user.id);
        await p(user.id, { ...state, revision: 1 });
        assert.deepEqual(states, [30,32,1], 'a deleted account ID can be reused by a new account');
      });
    } finally { await other.close(); await connection.close(); await fixture.cleanup(); }
  });
}
