import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';
import * as catalog from '../../src/domain/catalogs.ts';
import * as entries from '../../src/domain/timeEntries.ts';
import { createTimerOperations, createTimerPublication, createCatalogTimerEffects, createAccountEntryEffects, touchTimer } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount, entryAt as at } from './support/entry-timer.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: canonical metadata, same-context catalog and account effects`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, entryTimerFactory(backend));
    try {
      const admin = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('admin', 'admin')));
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('owner')));
      const wid = user.defaultWorkspaceId;
      const events: Array<[number, number]> = [];
      const publish = createTimerPublication(async (id, state) => { events.push([id, state.revision]); });
      const timer = createTimerOperations(runner, publish), effects = createAccountEntryEffects<ReturnType<ReturnType<typeof entryTimerFactory>>>(publish);
      const accounts = createAccountOperations(runner, { async recheckUser() {} });
      const client = await runner.transaction(ctx => catalog.createClient(ctx, wid, { name: 'Client' }));
      const project = await runner.transaction(ctx => catalog.createProject(ctx, wid, { name: 'Project', client_id: client.id }));
      const task = await runner.transaction(ctx => catalog.createTask(ctx, wid, project.id, { name: 'Task' }));
      const e = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { project_id: project.id, task_id: task.id, tags: ['Z', 'a'], start: at('09:00:00').toISOString() }, publish));
      await t.test('metadata changes number visible labels and tag order is canonical', async () => {
        let state = await timer.getTimerState(user.id); const before = events.length;
        await runner.transaction(async ctx => {
          const fx = createCatalogTimerEffects(ctx, publish);
          await catalog.updateClient(ctx, wid, client.id, { name: 'Renamed client' }, fx);
          await catalog.updateProject(ctx, wid, project.id, { name: 'Renamed project' }, fx);
          await catalog.updateTask(ctx, wid, project.id, task.id, { name: 'Renamed task' }, fx);
          await catalog.updateTag(ctx, wid, e.tags[0]!.id, { name: 'renamed tag' }, fx);
        });
        const changed = await timer.getTimerState(user.id);
        assert.equal(changed.revision, state.revision + 1); assert.equal(events.length, before + 1);
        assert.equal(changed.running_entry?.client_name, 'Renamed client');
        assert.equal(changed.running_entry?.project_name, 'Renamed project');
        assert.equal(changed.running_entry?.task_name, 'Renamed task');
        state = changed;
        await runner.transaction(async ctx => { await entries.updateTimeEntry(ctx, user, wid, e.id, { tag_ids: [...e.tags].reverse().map(t => t.id) }, publish); });
        assert.equal((await timer.getTimerState(user.id)).revision, state.revision);
      });
      await t.test('pause tag deletion, project detachment and destructive preparation preserve owners', async () => {
        let state = await timer.pauseTimer(user.id, at('09:10:00'));
        const before = state.revision;
        await runner.transaction(async ctx => {
          const fx = createCatalogTimerEffects(ctx, publish);
          await catalog.deleteTag(ctx, wid, e.tags[0]!.id, fx);
          await catalog.deleteTask(ctx, wid, project.id, task.id, fx);
          await catalog.deleteProject(ctx, wid, project.id, false, fx);
        });
        state = await timer.getTimerState(user.id);
        assert.equal(state.revision, before + 1); assert.equal(state.pause?.project_id, null); assert.equal(state.pause?.task_id, null);
        assert.equal(state.pause?.tag_ids.length, 1);
        const resumed = await timer.resumeTimer(user.id, state.revision, at('09:15:00')); assert.equal(resumed.running_entry?.project_id, null);
      });
      await t.test('rollback and dry run never publish, savepoints restore timer hooks', async () => {
        const before = await timer.getTimerState(user.id), count = events.length;
        await assert.rejects(runner.transaction(async ctx => {
          await entries.updateTimeEntry(ctx, user, wid, before.running_entry!.id, { description: 'rollback' }, publish); throw new Error('rollback');
        }), /rollback/);
        await runner.transaction(async ctx => {
          await entries.protectEntryOperation(ctx, user.id, [wid]);
          await ctx.savepoint(async sp => { await entries.updateTimeEntry(sp, user, wid, before.running_entry!.id, { description: 'savepoint' }, publish); throw new Error('savepoint'); }).catch(() => {});
        });
        const dry = createTransactionRunner(connection, entryTimerFactory(backend));
        await dry.transaction(ctx => entries.updateTimeEntry(ctx, user, wid, before.running_entry!.id, { description: 'dry' }, publish), { dryRun: true });
        assert.equal(events.length, count);
        assert.equal((await timer.getTimerState(user.id)).running_entry?.description, before.running_entry?.description);
      });
      await t.test('timezone changes reanchor live and trashed all-day rows across DST under the user guard', async () => {
        const first = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { all_day: true, start_date: '2026-03-29', duration: 3600 }, publish));
        const second = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { all_day: true, start_date: '2026-10-25', duration: 1800 }, publish));
        await runner.transaction(ctx => entries.deleteTimeEntry(ctx, user.id, wid, second.id, publish));
        await accounts.updateProfile(user, { kind: 'api-token', token: user.apiToken }, { timezone: 'Europe/Madrid' }, effects);
        const rows = await runner.readSnapshot(ctx => ctx.entries.listAllDay(user.id));
        assert.equal(rows.find(r => r.id === first.id)?.start, '2026-03-28T23:00:00.000Z');
        assert.equal(rows.find(r => r.id === second.id)?.start, '2026-10-24T22:00:00.000Z');
        assert.ok(rows.find(r => r.id === second.id)?.deletedAt);
      });
      await t.test('repeated destructive preparation still publishes the initially affected timer', async () => {
        const p = await runner.transaction(ctx => catalog.createProject(ctx, wid, { name: 'Destructive' }));
        const started = await runner.transaction(ctx => entries.createTimeEntry(ctx, user, wid, { project_id: p.id, start: at('09:40:00').toISOString() }, publish));
        const before = await timer.getTimerState(user.id), count = events.length;
        await runner.transaction(async ctx => {
          const fx = createCatalogTimerEffects(ctx, publish);
          await catalog.deleteProject(ctx, wid, p.id, true, fx);
          await catalog.updateClient(ctx, wid, client.id, { name: 'Second preparation' }, fx);
        });
        const after = await timer.getTimerState(user.id);
        assert.equal(after.running_entry, null); assert.equal(after.revision, before.revision + 1);
        assert.equal(events.length, count + 1);
        assert.ok((await runner.readSnapshot(ctx => ctx.entries.get(user.id, started.id, true)))?.deletedAt);
      });
      await t.test('one failed metadata subscriber does not suppress another affected user', async () => {
        const member = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('listener')));
        await runner.transaction(ctx => ctx.workspaces.addMember({ workspaceId: wid, userId: member.id, role: 'member' }));
        const p = await runner.transaction(ctx => catalog.createProject(ctx, wid, { name: 'Notifications' }));
        for (const owner of [user, member]) await runner.transaction(ctx => entries.createTimeEntry(ctx, owner, wid, { start: at('10:00:00').toISOString(), project_id: p.id }, publish));
        const heard: number[] = [];
        const broken = createTimerPublication(async (id) => { heard.push(id); if (id === user.id) throw new Error('subscriber'); });
        await runner.transaction(async ctx => { const fx = createCatalogTimerEffects(ctx, broken); await catalog.updateProject(ctx, wid, p.id, { name: 'Delivered' }, fx); });
        assert.deepEqual(heard, [user.id, member.id]);
        // Leave the original user's workspace sole before deletion.
        await connection.db.deleteFrom('workspace_users').where('workspace_id', '=', wid).where('user_id', '=', member.id).execute();
      });
      await t.test('account deletion settles former members in sole workspaces', async () => {
        const former = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('former')));
        await runner.transaction(ctx => ctx.workspaces.addMember({ workspaceId: wid, userId: former.id, role: 'member' }));
        await runner.transaction(ctx => entries.createTimeEntry(ctx, former, wid, { start: at('10:00:00').toISOString() }, publish));
        await connection.db.deleteFrom('workspace_users').where('workspace_id', '=', wid).where('user_id', '=', former.id).execute();
        const before = await timer.getTimerState(former.id);
        await accounts.deleteAccount(admin.id, user.id, user.email, effects);
        assert.equal(await runner.readSnapshot(ctx => ctx.users.get(user.id)), undefined);
        const after = await timer.getTimerState(former.id);
        assert.equal(after.running_entry, null); assert.equal(after.revision, before.revision + 1);
        assert.equal(await runner.readSnapshot(ctx => ctx.timers.getSession(user.id)), undefined);
      });
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
