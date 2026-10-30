import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { createStorageImports } from '../../src/services/storageImportJson.ts';
import { buildJsonExport } from '../../src/services/storageExport.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { createTimeEntry, stopTimeEntry } from '../../src/domain/timeEntries.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: real constraint recovery, sequential savepoints and full dry-run equivalence`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => ({ ...entryTimerFactory(backend)(db), ...createTransferRepositories(db, backend) }));
    const events: unknown[] = [], publish = createTimerPublication(async (id, state) => { events.push([id, state]); });
    const imports = createStorageImports({
      async transaction(work, options) {
        return runner.transaction(async ctx => {
          const createClient = ctx.clients.create.bind(ctx.clients), createEntry = ctx.entries.create.bind(ctx.entries), createTask = ctx.tasks.create.bind(ctx.tasks);
          ctx.clients.create = async input => {
            const result = await createClient(input);
            if (input.name === 'bad db') {
              ctx.beforeCommit('failed-client', async () => { throw new Error('Failed entity hook leaked'); });
              ctx.afterCommit(async () => { events.push('failed-client'); });
              await createClient(input); // Actual engine unique violation after the first write.
            }
            return result;
          };
          ctx.tasks.create = async input => {
            const result = await createTask(input);
            if (input.name === 'bad task db') {
              ctx.beforeCommit('failed-task', async () => { throw new Error('Failed task hook leaked'); });
              await createTask(input);
            }
            return result;
          };
          ctx.entries.create = async input => {
            const result = await createEntry(input);
            if (input.description === 'bad db') {
              ctx.beforeCommit('failed-entry', async () => { throw new Error('Failed entry hook leaked'); });
              ctx.afterCommit(async () => { events.push('failed-entry'); });
              await createEntry({ ...input, projectId: 99999999 }); // Actual engine FK violation after side effects.
            }
            return result;
          };
          return work(ctx);
        }, options);
      },
    }, publish);
    const state = async () => {
      const output: Record<string, unknown> = {};
      for (const table of ['clients', 'projects', 'tasks', 'tags', 'time_entries', 'time_entry_tags', 'timer_states', 'pause_chains', 'pomodoro_sessions'] as const) {
        output[table] = await connection.db.selectFrom(table satisfies keyof PhysicalDatabase).selectAll().execute();
      }
      return output;
    };
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('recover')));
      await t.test('JSON entity and entry constraint failures unwind before later valid units', async () => {
        const file = { format: 'tokkl-export', clients: [{ id: 1, name: 'bad db' }, { id: 2, name: 'valid' }],
          projects: [{ id: 3, name: 'orphan', client_id: 1 }, { id: 4, name: 'good', client_id: 2, active: false }],
          tasks: [{ id: 7, project_id: 4, name: 'bad task db' }, { id: 8, project_id: 4, name: 'good task' }],
          time_entries: [{ id: 5, description: 'bad db', start: '2026-10-01T09:02:31Z', stop: '2026-10-01T09:13:07Z' },
            { id: 6, description: 'valid', project_id: 4, task_id: 8, start: '2026-10-01T09:02:31Z', stop: '2026-10-01T09:13:07Z' }] };
        const before = await state(), beforeEvents = [...events];
        const dry = await imports.importJsonExport(user.id, file, { dryRun: true });
        assert.deepEqual([dry.clients, dry.projects, dry.tasks, dry.time_entries], [1, 1, 1, 1]);
        assert.deepEqual(dry.errors.map(e => [e.entity, e.id]), [['client', 1], ['project', 3], ['task', 7], ['time_entry', 5]]);
        assert.match(dry.errors[0]!.message, /taken/); assert.match(dry.errors[3]!.message, /foreign-key/);
        assert.deepEqual(await state(), before); assert.deepEqual(events, beforeEvents);
        const result = await imports.importJsonExport(user.id, file, { dryRun: false });
        assert.deepEqual(result.errors, dry.errors);
        const out = await buildJsonExport(runner, user.id);
        assert.deepEqual(out.clients.map(c => c.name), ['valid']); assert.deepEqual(out.projects.map(p => p.name), ['good']);
        assert.equal(out.projects[0]?.active, false); assert.deepEqual(out.tasks.map(t => t.name), ['good task']);
        assert.deepEqual(out.time_entries.map(e => [e.description, e.start]), [['valid', '2026-10-01T09:02:31+00:00']]);
        const again = await imports.importJsonExport(user.id, file, { dryRun: false });
        assert.deepEqual([again.clients, again.projects, again.time_entries, again.skipped_duplicates], [0, 0, 0, 1]);
      });
      await t.test('CSV opaque selection and a failed row rolls back catalogs, tags and hooks', async () => {
        const csv = ['User,Email,Client,Project,Task,Description,Start date,Start time,Duration,Tags',
          'Alice,a@example.test,new,bad project,failed task,bad db,2026-10-02,09:00:01,0:10:03,failed tag',
          'Alice,a@example.test,new,good project,good task,okay,2026-10-02,10:00:01,0:10:03,good tag',
          'Alice,a@example.test,,, ,invalid,invalid,10:00:01,0:10:03,',
          '"Alice <a@example.test>",,other,unselected,,hidden,2026-10-02,11:00:00,0:10:03,hidden'].join('\n');
        const before = await state(), beforeEvents = [...events];
        const preview = await imports.importTogglCsv(user.id, csv, { dryRun: true });
        assert.equal(preview.users?.length, 2); assert.equal(preview.created, 2);
        assert.deepEqual(await state(), before); assert.deepEqual(events, beforeEvents);
        await assert.rejects(imports.importTogglCsv(user.id, csv, { dryRun: false }), { status: 400 });
        await assert.rejects(imports.importTogglCsv(user.id, csv, { dryRun: false, users: [] }), { status: 400 });
        await assert.rejects(imports.importTogglCsv(user.id, csv, { dryRun: false, users: ['unknown'] }), { status: 400 });
        const options = { dryRun: false, users: [preview.users![0]!.key] };
        const result = await imports.importTogglCsv(user.id, csv, options);
        assert.deepEqual([result.created, result.errors.map(e => e.row)], [1, [2, 4]]);
        assert.deepEqual(result.created_clients, ['new']); assert.deepEqual(result.created_projects, ['good project (new)']);
        assert.equal(result.skipped?.[0]?.rows, 1);
        const out = await buildJsonExport(runner, user.id);
        assert.deepEqual(out.tags.map(g => g.name), ['good tag']);
        assert.ok(!JSON.stringify(out).includes('failed task')); assert.ok(!JSON.stringify(out).includes('bad project'));
        const again = await imports.importTogglCsv(user.id, csv, options);
        assert.deepEqual([again.created, again.skipped_duplicates], [0, 1]);
      });
      await t.test('dry-running a live timer exercises settlement without rows, revisions or events', async () => {
        const file = { format: 'tokkl-export', time_entries: [{ id: 1, start: '2026-10-03T09:00:07Z', description: 'preview timer' }] };
        const before = await state(), beforeEvents = [...events];
        const dry = await imports.importJsonExport(user.id, file, { dryRun: true });
        assert.equal(dry.time_entries, 1); assert.deepEqual(dry.errors, []);
        assert.deepEqual(await state(), before); assert.deepEqual(events, beforeEvents);
        await imports.importJsonExport(user.id, file, { dryRun: false });
        assert.ok(events.length > beforeEvents.length);
        const after = await state(), emitted = [...events];
        const refused = await imports.importJsonExport(user.id, { ...file, time_entries: [{ id: 2, start: '2026-10-03T10:00:07Z', description: 'replacement' }] }, { dryRun: false });
        assert.deepEqual(refused.errors, [{ entity: 'time_entry', id: 2, message: 'Another timer is running here. Stop it and restore again to import this running entry' }]);
        assert.deepEqual(await state(), after); assert.deepEqual(events, emitted);
        assert.equal((await imports.importJsonExport(user.id, file, { dryRun: false })).skipped_duplicates, 1);
        const current = (await runner.readSnapshot(ctx => ctx.entries.running(user.id)))!;
        await runner.transaction(ctx => stopTimeEntry(ctx, user, user.defaultWorkspaceId, current.id, publish, '2026-10-03T09:10:07Z'));
        const replacement = { format: 'tokkl-export', time_entries: [{ id: 2, start: '2026-10-03T10:00:07Z', description: 'replacement' }] };
        assert.equal((await imports.importJsonExport(user.id, replacement, { dryRun: false })).time_entries, 1);
        assert.equal((await imports.importJsonExport(user.id, replacement, { dryRun: false })).skipped_duplicates, 1);
      });
      await t.test('a stale default membership refuses all mutations', async () => {
        const stranger = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('stranger')));
        await connection.db.updateTable('users').set({ default_workspace_id: user.defaultWorkspaceId }).where('id', '=', stranger.id).execute();
        const before = await state();
        for (const dryRun of [true, false]) await assert.rejects(imports.importJsonExport(stranger.id,
          { format: 'tokkl-export', clients: [{ id: 9, name: 'intruder' }] }, { dryRun }), { status: 403 });
        assert.deepEqual(await state(), before);
      });
      await t.test('cross-workspace timer and lower-ID owners retain guard order during archive restore', async () => {
        const owner = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('owner')));
        await runner.transaction(async ctx => {
          await ctx.workspaces.addMember({ userId: user.id, workspaceId: owner.defaultWorkspaceId, role: 'member' });
          await ctx.workspaces.addMember({ userId: owner.id, workspaceId: user.defaultWorkspaceId, role: 'member' });
        });
        // The importing user's timer uses the lower workspace; its default workspace has a lower-ID timer owner.
        const other = await runner.transaction(ctx => createTimeEntry(ctx, user, owner.defaultWorkspaceId,
          { start: '2026-10-04T09:00:00Z' }, publish));
        await runner.transaction(ctx => createTimeEntry(ctx, owner, user.defaultWorkspaceId, { start: '2026-10-04T10:00:00Z' }, publish));
        const file = { format: 'tokkl-export', projects: [{ id: 1, name: 'archived', active: false }],
          tasks: [{ id: 2, name: '', project_id: 1 }, { id: 3, name: 'valid', project_id: 1 }] };
        const result = await imports.importJsonExport(owner.id, file, { dryRun: false });
        assert.equal(result.tasks, 1); assert.equal(result.errors.length, 1);
        assert.equal((await runner.readSnapshot(ctx => ctx.entries.get(user.id, other.id)))?.stop, null);
      });
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
