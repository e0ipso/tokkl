import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_DURATION_SECONDS } from '@tokkl/common/duration';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import * as entries from '../../src/domain/timeEntries.ts';
import * as catalog from '../../src/domain/catalogs.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount, entryAt as at } from './support/entry-timer.ts';
const fixtures = JSON.parse(readFileSync(new URL('../../../common/fixtures/snap.json', import.meta.url), 'utf8')) as Array<{
  name: string; input: { start: string; stop: string; minutes: number; timeZone: string }; expected: { start: string; stop: string } | null;
}>;
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: shared time rules, validation, bulk partial success and trash`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, entryTimerFactory(backend));
    const publish = createTimerPublication(async () => {});
    try {
      let user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('rules')));
      const wid = user.defaultWorkspaceId;
      for (const f of fixtures.filter(f => !f.expected || typeof f.expected.start === 'string')) await t.test(f.name, async () => {
        await runner.transaction(async ctx => {
          await ctx.users.updateAccount(user.id, { timezone: f.input.timeZone });
          await ctx.settings.write([{ key: 'timeResolutionMinutes', value: f.input.minutes, updatedAt: at('00:00:00').toISOString(), updatedBy: null }]);
        });
        user = (await runner.readSnapshot(ctx => ctx.users.get(user.id)))!;
        const work = () => runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: f.input.start, stop: f.input.stop }, publish));
        if (!f.expected) await assert.rejects(work(), { status: 400 });
        else { const row = await work(); assert.equal(row.start, f.expected.start); assert.equal(row.stop, f.expected.stop); }
      });
      await runner.transaction(async ctx => {
        await ctx.users.updateAccount(user.id, { timezone: 'UTC' });
        await ctx.settings.write([{ key: 'timeResolutionMinutes', value: 5, updatedAt: at('00:00:00').toISOString(), updatedBy: null }]);
      });
      user = (await runner.readSnapshot(ctx => ctx.users.get(user.id)))!;
      await t.test('exact import, unchanged zero length, DTO fields and reference scoping', async () => {
        const zero = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('08:00:01').toISOString(), duration: 0 }, publish, { exact: true }));
        const edited = await runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, zero.id, { description: 'kept', tags: ['Zulu', 'alpha', 'ALPHA'] }, publish));
        assert.equal(edited.start, zero.start); assert.equal(edited.stop, zero.stop); assert.equal(edited.tags.length, 2);
        assert.deepEqual(edited.tags.map(t => t.name), ['alpha', 'Zulu']);
        const dto = entries.serializeTimeEntry(edited, { meta: true, user });
        assert.equal(dto.duration, 0); assert.equal(dto.uid, user.id); assert.equal(dto.user_name, user.fullName);
        assert.equal(dto.start, '2026-10-14T08:00:01+00:00'); assert.equal(dto.project_active, null);
        assert.deepEqual(dto.expense_ids, []); assert.equal(dto.permissions, null);
        const p = await runner.transaction(ctx => catalog.createProject(ctx, wid, { name: 'Billable', billable: true }));
        const task = await runner.transaction(ctx => catalog.createTask(ctx, wid, p.id, { name: 'Task' }));
        const e = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('08:00:00').toISOString(), duration: 600, task_id: task.id }, publish));
        assert.equal(e.projectId, p.id); assert.equal(e.billable, true);
        const p2 = await runner.transaction(ctx => catalog.createProject(ctx, wid, { name: 'Plain', active: false }));
        const switched = await runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, e.id, { project_id: p2.id }, publish));
        assert.equal(switched.taskId, null); assert.equal(switched.billable, false);
        for (const body of [{ project_id: 999999 }, { task_id: 999999 }, { tag_ids: [999999] }]) await assert.rejects(runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, e.id, body, publish)), { status: 404 });
        await assert.rejects(runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, e.id, { task_id: task.id }, publish)), { status: 400 });
      });
      await t.test('bad timestamps and all-day validation leave no partial tags or entries', async () => {
        for (const body of [{ start: '2026-02-30T12:00:00Z' }, { start: '2026-10-14T09:00:00' }, { start: 4 },
          { all_day: true }, { all_day: true, duration: -1 }, { all_day: true, duration: 90000 }, { all_day: true, duration: 1 },
          { start: at('09:00:00').toISOString(), stop: at('09:10:00').toISOString(), duration: 300 }]) {
          const before = (await runner.readSnapshot(ctx => ctx.entries.list(user.id))).length;
          await assert.rejects(runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { ...body, tags: ['not-created'] }, publish)), { status: 400 });
          assert.equal((await runner.readSnapshot(ctx => ctx.entries.list(user.id))).length, before);
        }
      });
      await t.test('all-day DST anchoring, exact durations, edits and partial bulk PATCH', async () => {
        await runner.transaction(ctx => ctx.users.updateAccount(user.id, { timezone: 'Europe/Madrid' }));
        const all = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { all_day: true, start_date: '2026-03-29', duration: 3661 }, publish, { exact: true }));
        assert.equal(all.start, '2026-03-28T23:00:00.000Z'); assert.equal(entries.entryDurationSeconds(all), 3661);
        const renamed = await runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, all.id, { description: 'same' }, publish));
        assert.equal(renamed.stop, all.stop);
        const timed = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('08:00:00').toISOString(), duration: 600 }, publish));
        const partial = await runner.transaction(ctx => entries.patchTimeEntries(ctx, user, wid, [timed.id, all.id, 999999], [{ op: 'replace', path: '/description', value: 'must rollback for all-day' }, { op: 'replace', path: '/start', value: at('08:01:00').toISOString() }], publish));
        assert.deepEqual(partial.success, [timed.id]); assert.deepEqual(partial.failure.map(x => x.id), [all.id, 999999]);
        assert.equal((await runner.readSnapshot(ctx => ctx.entries.get(user.id, all.id)))?.description, 'same');
        const changed = await runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, all.id, { start_date: '2026-10-25', duration: 3600 }, publish));
        assert.equal(changed.start, '2026-10-24T22:00:00.000Z');
        await assert.rejects(runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, all.id, { start: at('08:00:00').toISOString() }, publish)), { status: 400 });
        await assert.rejects(runner.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, all.id, { all_day: false }, publish)), { status: 400 });
      });
      await t.test('zero stop removal, back-to-back switching, restore and 999-hour clamp', async () => {
        const first = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('10:00:00').toISOString() }, publish));
        const stopped = await runner.transaction(ctx => entries.stopTimeEntry(ctx, user, wid, first.id, publish, at('10:00:10').toISOString()));
        assert.equal(entries.entryDurationSeconds(stopped), 0); assert.ok(stopped.deletedAt);
        assert.equal((await runner.transaction(ctx => entries.restoreTimeEntry(ctx, user, first.id, publish))).deletedAt, null);
        const a = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('11:00:00').toISOString() }, publish));
        const b = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('11:07:40').toISOString() }, publish));
        const stopB = await runner.transaction(ctx => entries.stopTimeEntry(ctx, user, wid, b.id, publish, at('11:20:00').toISOString()));
        assert.equal((await runner.readSnapshot(ctx => ctx.entries.get(user.id, a.id)))?.stop, stopB.start);
        const long = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { start: at('12:00:00').toISOString() }, publish));
        const cap = new Date(at('12:00:00').getTime() + (MAX_DURATION_SECONDS + 3600) * 1000);
        const capped = await runner.transaction(ctx => entries.stopTimeEntry(ctx, user, wid, long.id, publish, cap.toISOString()));
        assert.equal(entries.entryDurationSeconds(capped), MAX_DURATION_SECONDS);
        await runner.transaction(ctx => entries.deleteTimeEntry(ctx, user.id, wid, capped.id, publish));
        assert.ok((await runner.readSnapshot(ctx => ctx.entries.listDeleted(user.id))).some(e => e.id === capped.id));
        assert.equal(await runner.transaction(ctx => entries.purgeDeletedEntries(ctx, user.id, publish, capped.id)), 1);
      });
      await t.test('catalog creation composes before entry creation in one import operation', async () => {
        const created = await runner.transaction(async ctx => {
          const project = await catalog.createProject(ctx, wid, { name: 'Import project' });
          return entries.createTimeEntry(ctx, user, wid, { start: at('14:00:00').toISOString(), duration: 600, project_id: project.id }, publish, { exact: true });
        });
        assert.equal(created.project?.name, 'Import project');
      });
      await t.test('recoverable database error rolls back before next real entry succeeds', async () => {
        await runner.transaction(async ctx => {
          await entries.protectEntryOperation(ctx, user.id, [wid]);
          const running = await entries.createTimeEntry(ctx, user, wid, { start: at('15:00:00').toISOString() }, publish);
          await assert.rejects(ctx.savepoint(sp => sp.entries.create({ ...running, description: 'duplicate live', tagIds: [] })), { kind: 'unique' });
          const good = await entries.createTimeEntry(ctx, user, wid, { start: at('16:00:00').toISOString(), duration: 600 }, publish);
          assert.equal(good.description, '');
        });
      });
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
