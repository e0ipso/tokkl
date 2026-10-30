import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';
import { createCatalogRepositories } from '../../src/storage/repositories/catalogs.ts';
import { createEntryRepositories } from '../../src/storage/repositories/entries.ts';
import { createTimerRepositories } from '../../src/storage/repositories/timers.ts';
import * as entries from '../../src/domain/timeEntries.ts';
import { createTimerOperations, createTimerPublication } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
const at = (time: string) => new Date(`2026-10-14T${time}Z`);
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: timer pause, stale revision, Pomodoro discard and committed result`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => ({ ...createAccountRepositories(db, backend), ...createCatalogRepositories(db, backend), ...createEntryRepositories(db, backend), ...createTimerRepositories(db, backend) }));
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount({ email: 'timer@example.test', fullName: 'Timer', passwordHash: 'hash', apiToken: 'token', timezone: 'UTC', role: 'admin', preferences: {} }));
      const events: number[] = [];
      const publish = createTimerPublication(async (id, state) => {
        events.push(state.revision);
        assert.equal((await runner.readSnapshot(ctx => ctx.timers.getRevision(id)))?.revision, state.revision);
      });
      const timer = createTimerOperations(runner, publish);
      assert.equal((await timer.getTimerState(user.id, at('09:00:00'))).revision, 0);
      const entry = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, user.defaultWorkspaceId, { start: at('09:00:00').toISOString(), tags: ['Z', 'a'] }, publish));
      const paused = await timer.pauseTimer(user.id, at('09:10:00'));
      assert.equal(paused.pause?.seconds, 600); assert.equal(paused.running_entry, null);
      await assert.rejects(timer.resumeTimer(user.id, 0, at('09:11:00')), { status: 409, body: { ...paused, server_time: at('09:11:00').toISOString() } });
      const resumed = await timer.resumeTimer(user.id, paused.revision, at('09:15:00'));
      assert.deepEqual(resumed.running_entry?.tags, ['a', 'Z']);
      const again = await timer.pauseTimer(user.id, at('09:15:10')); assert.equal(again.pause?.seconds, 600);
      const idle = await timer.discardPause(user.id, again.revision, at('09:16:00')); assert.equal(idle.pause, null);
      const started = await timer.startPomodoro(user.id, {}, at('10:00:00'));
      const ended = await timer.endPomodoro(user.id, started.revision, at('10:00:10'));
      assert.equal(ended.discarded_pomodoro?.entry_id, started.running_entry?.id);
      assert.deepEqual(await timer.getTimerState(user.id, at('10:00:10')), ended);
      let cycle = await timer.startPomodoro(user.id, { description: 'draft', work_minutes: 1, short_rest_minutes: 1, long_rest_minutes: 1, long_rest_every: 2 }, at('11:00:00'));
      const original = cycle.running_entry!.id;
      await assert.rejects(timer.pauseTimer(user.id, at('11:00:01')), { status: 409 });
      await assert.rejects(timer.startPomodoro(user.id, {}, at('11:00:01')), { status: 409 });
      cycle = await timer.nextPomodoroPhase(user.id, cycle.revision, at('11:05:00'));
      assert.equal(cycle.pomodoro?.phase.kind, 'shortRest'); assert.equal(cycle.running_entry?.id, original);
      await runner.transaction(ctx => entries.updateTimeEntry(ctx, user, user.defaultWorkspaceId, original, { description: 'final', tags: ['carry'] }, publish));
      cycle = await timer.getTimerState(user.id, at('11:06:00'));
      cycle = await timer.nextPomodoroPhase(user.id, cycle.revision, at('11:10:00'));
      assert.notEqual(cycle.running_entry?.id, original); assert.equal(cycle.running_entry?.description, 'final'); assert.deepEqual(cycle.running_entry?.tags, ['carry']);
      assert.equal(cycle.pomodoro?.number, 2); assert.equal(cycle.pomodoro?.transition, 'workToLongRest');
      const discarded = cycle.running_entry!.id;
      cycle = await timer.nextPomodoroPhase(user.id, cycle.revision, at('11:10:05'));
      assert.equal(cycle.pomodoro?.phase.kind, 'longRest');
      cycle = await timer.nextPomodoroPhase(user.id, cycle.revision, at('11:10:10'));
      assert.equal(cycle.pomodoro?.number, 1); assert.equal(cycle.discarded_pomodoro?.entry_id, discarded);
      cycle = await timer.endPomodoro(user.id, cycle.revision, at('11:20:00'));
      assert.equal(cycle.discarded_pomodoro, null);
      for (const revision of ['0', 0.5, Infinity, null, undefined, true]) await assert.rejects(timer.resumeTimer(user.id, revision), { status: 400 });
      await runner.transaction(ctx => entries.createTimeEntry(ctx, user, user.defaultWorkspaceId, { start: at('12:00:00').toISOString() }, publish));
      let chain = await timer.pauseTimer(user.id, at('12:10:00'));
      chain = await timer.resumeTimer(user.id, chain.revision, at('12:15:00'));
      chain = await timer.pauseTimer(user.id, at('12:20:00')); assert.equal(chain.pause?.seconds, 900);
      await timer.discardPause(user.id, chain.revision, at('12:25:00'));
      assert.deepEqual(events, [...new Set(events)].sort((a,b) => a-b));
      assert.equal((await runner.readSnapshot(ctx => ctx.entries.get(user.id, entry.id)))?.stop, at('09:10:00').toISOString());
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
