import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { CompiledQuery, QueryResult, AbortableOperationOptions } from 'kysely';
import type { EntryInput } from '../../src/storage/contracts.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { withExactEntryImport, type ExactEntryImport } from '../../src/domain/timeEntries.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createStorageImports } from '../../src/services/storageImportJson.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';

test('sqlite: guarded import bounds actual statement growth and stable guard reads', async t => {
  const fixture = await disposableBackend('sqlite'), connection = await initializeDatabase(fixture.config);
  const runner = createTransactionRunner(connection, entryTimerFactory('sqlite'));
  const imports = createStorageImports(runner, async () => {}), statements: string[] = [];
  let collecting = false;
  const undo = await connection.db.getExecutor().provideConnection(async driver => {
    const original = driver.executeQuery;
    driver.executeQuery = async function<R>(query: CompiledQuery, options?: AbortableOperationOptions): Promise<QueryResult<R>> {
      if (collecting) statements.push(query.sql);
      return original.call(this, query, options) as Promise<QueryResult<R>>;
    };
    return () => { driver.executeQuery = original; };
  });
  try {
    const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('query-bound')));
    const rows = 40;
    const file = { format: 'tokkl-export', projects: [{ id: 1, name: 'Work' }], tasks: [{ id: 2, project_id: 1, name: 'Task' }],
      tags: [{ id: 3, name: 'Tag' }], time_entries: Array.from({ length: rows }, (_, id) => ({ id, description: `row ${id}`,
        start: '2026-10-01T09:00:07Z', stop: '2026-10-01T09:01:11Z', project_id: 1, task_id: 2, tag_ids: [3] })) };
    collecting = true;
    const result = await imports.importJsonExport(user.id, file, { dryRun: false });
    collecting = false;
    const metrics = { rows, statements: statements.length, users: statements.filter(q => /from "users"/.test(q)).length,
      settings: statements.filter(q => /from "instance_settings"/.test(q)).length,
      running: statements.filter(q => /from "time_entries" as "e".*"e"\."stop" is null/.test(q)).length };
    t.diagnostic(JSON.stringify(metrics));
    assert.equal(result.time_entries, rows); assert.deepEqual(result.errors, []);
    assert.ok(metrics.users < 20, `stable user reads must be constant: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.settings, 0, 'exact stopped imports do not need snapping settings');
    assert.ok(metrics.statements <= rows * 7 + 100, `row work must exclude repeated guards/projections: ${JSON.stringify(metrics)}`);
    statements.length = 0; collecting = true;
    const csv = ['Client,Project,Task,Description,Start date,Start time,Duration,Tags',
      ...Array.from({ length: rows }, (_, id) => `Client,CSV Work,Task,csv ${id},2026-10-02,09:00:07,0:01:04,CSV Tag`)].join('\n');
    const preview = await imports.importTogglCsv(user.id, csv, { dryRun: true }); collecting = false;
    const csvMetrics = { rows, statements: statements.length, users: statements.filter(q => /from "users"/.test(q)).length,
      settings: statements.filter(q => /from "instance_settings"/.test(q)).length };
    t.diagnostic(JSON.stringify({ csvPreview: csvMetrics }));
    assert.equal(preview.created, rows); assert.deepEqual(preview.errors, []);
    assert.ok(csvMetrics.users < 20); assert.equal(csvMetrics.settings, 0);
    assert.ok(csvMetrics.statements <= rows * 6 + 100, JSON.stringify(csvMetrics));
    const stored = await runner.readSnapshot(ctx => ctx.entries.list(user.id));
    assert.equal(stored.length, rows); assert.ok(stored.every(e => e.tags[0]?.name === 'Tag' && e.start === '2026-10-01T09:00:07.000Z'));
  } finally { undo(); await connection.close(); await fixture.cleanup(); }
});

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: scoped imports retain rollback, integrity, timer ordering and concurrent deduplication`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const factory = entryTimerFactory(backend), runner = createTransactionRunner(connection, factory);
    const events: unknown[] = [], publish = async (id: number, state: unknown) => { events.push([id, state]); };
    const imports = createStorageImports(runner, publish);
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('guarded')));
      const wid = user.defaultWorkspaceId;
      await t.test('invalid rows never publish; mixed stopped/running rows preserve the first timer', async () => {
        const invalid = { format: 'tokkl-export', time_entries: [{ id: 1, start: 'bad' },
          { id: 2, start: '2026-10-01T09:00:00Z', stop: '2026-09-01T09:00:00Z' }] };
        for (const dryRun of [false, true]) {
          const result = await imports.importJsonExport(user.id, invalid, { dryRun });
          assert.equal(result.time_entries, 0); assert.equal(result.errors.length, 2);
          assert.deepEqual(events, []);
        }
        const mixed = { format: 'tokkl-export', time_entries: [
          { id: 1, start: '2026-10-01T08:00:07Z', stop: '2026-10-01T08:00:07Z', description: 'zero' },
          { id: 2, start: '2026-10-01T09:00:07Z', description: 'first timer' },
          { id: 3, start: '2026-10-01T10:00:07Z', stop: '2026-10-01T10:01:13Z', description: 'stopped later' },
          { id: 4, start: '2026-10-01T11:00:07Z', description: 'refused timer' },
          { id: 5, start: '2026-10-01T12:00:07Z', description: 'x'.repeat(3001) },
        ] };
        const preview = await imports.importJsonExport(user.id, mixed, { dryRun: true });
        assert.equal(preview.time_entries, 3); assert.deepEqual(preview.errors.map(e => e.id), [4, 5]);
        assert.ok(preview.errors.every(e => e.message === 'Another timer is running here. Stop it and restore again to import this running entry'));
        assert.deepEqual(events, []); assert.deepEqual(await runner.readSnapshot(ctx => ctx.entries.list(user.id)), []);
        const result = await imports.importJsonExport(user.id, mixed, { dryRun: false });
        assert.equal(result.time_entries, 3); assert.deepEqual(result.errors, preview.errors);
        assert.equal(events.length, 1);
        assert.equal((await runner.readSnapshot(ctx => ctx.entries.running(user.id)))?.description, 'first timer');
        const repeat = await imports.importJsonExport(user.id, mixed, { dryRun: false });
        assert.equal(repeat.skipped_duplicates, 3); assert.equal(repeat.time_entries, 0); assert.equal(events.length, 1);
      });
      await t.test('insert keeps repository workspace/tag and foreign-key integrity', async () => {
        const other = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('foreign')));
        const foreignTag = await runner.transaction(ctx => ctx.tags.create(other.defaultWorkspaceId, 'Foreign'));
        const localTag = await runner.transaction(ctx => ctx.tags.create(wid, 'Local'));
        const input: EntryInput = { userId: user.id, workspaceId: wid, projectId: null, taskId: null, description: 'integrity',
          start: '2026-10-02T08:00:07.000Z', stop: '2026-10-02T08:01:07.000Z', billable: false, durationOnly: true,
          allDay: false, createdWith: 'test', deletedAt: null, tagIds: [foreignTag.id] };
        await runner.transaction(async ctx => {
          await assert.rejects(ctx.savepoint(() => ctx.entries.insert(input)), /Entry tag not found/);
          await assert.rejects(ctx.savepoint(() => ctx.entries.insert({ ...input, projectId: 999999999, tagIds: [] })), /foreign-key/);
          await ctx.entries.insert({ ...input, tagIds: [localTag.id, localTag.id] });
        });
        const stored = (await runner.readSnapshot(ctx => ctx.entries.list(user.id))).filter(e => e.description === 'integrity');
        assert.equal(stored.length, 1); assert.deepEqual(stored[0]?.tags, [{ id: localTag.id, name: 'Local' }]);
      });
      await t.test('scoped writer rejects escaped use and rolls back cached row-created tags', async () => {
        let escaped: ExactEntryImport | undefined;
        await runner.transaction(ctx => withExactEntryImport(ctx, user.id, wid, publish, async writer => {
          escaped = writer;
          await assert.rejects(writer.create({}), /requires a row savepoint/);
          await assert.rejects(writer.savepoint(async () => {
            await writer.create({ start: '2026-10-03T09:00:07Z', stop: '2026-10-03T09:01:07Z', tags: ['reused tag'] });
            throw new Error('after insert');
          }), /after insert/);
          await writer.savepoint(() => writer.create({ start: '2026-10-03T10:00:07Z', stop: '2026-10-03T10:01:07Z', tags: ['reused tag'] }));
        }));
        await assert.rejects(escaped!.create({}), /scope is closed/);
        await assert.rejects(escaped!.savepoint(async () => {}), /scope is closed/);
        const stored = (await runner.readSnapshot(ctx => ctx.entries.list(user.id))).filter(e => e.start.startsWith('2026-10-03'));
        assert.equal(stored.length, 1); assert.equal(stored[0]?.tags[0]?.name, 'reused tag');
      });
      await t.test('CSV failed row clears repeated catalog-name and reference caches', async () => {
        const csv = ['Client,Project,Task,Description,Start date,Start time,Duration,Tags',
          `Client,Project,Task,${'x'.repeat(3001)},2026-10-04,08:00:07,0:01:09,rollback tag`,
          'Client,Project,Task,valid,2026-10-04,08:00:07,0:01:09,rollback tag',
          'Client,Project,Task,valid,2026-10-04,08:00:07,0:01:09,rollback tag'].join('\n');
        const result = await imports.importTogglCsv(user.id, csv, { dryRun: false });
        assert.equal(result.created, 1); assert.equal(result.skipped_duplicates, 1); assert.deepEqual(result.errors.map(e => e.row), [2]);
        assert.deepEqual(result.created_clients, ['Client']); assert.deepEqual(result.created_projects, ['Project (Client)']);
      });
      await t.test('independent connections wait on held import guards before duplicate restore', async () => {
        const second = await openConnection<PhysicalDatabase>(fixture.config), other = createTransactionRunner(second, factory);
        try {
          const file = { format: 'tokkl-export', time_entries: [{ id: 1, description: 'race',
            start: '2026-10-05T08:00:07Z', stop: '2026-10-05T08:01:09Z' }] };
          const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), attempted = Promise.withResolvers<void>();
          const heldImports = createStorageImports({
            transaction: (work, options) => runner.transaction(async ctx => {
              const insert = ctx.entries.insert.bind(ctx.entries);
              ctx.entries.insert = async input => {
                const id = await insert(input); entered.resolve(); await release.promise; return id;
              };
              return work(ctx);
            }, options),
          }, publish);
          const waitingImports = createStorageImports({
            transaction: (work, options) => {
              // SQLite waits at BEGIN IMMEDIATE, before domain guard acquisition.
              if (backend === 'sqlite') attempted.resolve();
              return other.transaction(async ctx => {
                const lock = ctx.lockWorkspaces.bind(ctx);
                ctx.lockWorkspaces = async ids => { attempted.resolve(); await lock(ids); };
                return work(ctx);
              }, options);
            },
          }, publish);
          const first = heldImports.importJsonExport(user.id, file, { dryRun: false });
          await entered.promise;
          let finished = false;
          const secondImport = waitingImports.importJsonExport(user.id, file, { dryRun: false }).finally(() => { finished = true; });
          try {
            await attempted.promise; await delay(25);
            assert.equal(finished, false, 'the second import waits while the first holds workspace and user guards');
          } finally { release.resolve(); }
          const outcomes = await Promise.all([first, secondImport]);
          assert.equal(outcomes.reduce((n, r) => n + r.time_entries, 0), 1);
          assert.equal(outcomes.reduce((n, r) => n + r.skipped_duplicates, 0), 1);
          assert.ok(outcomes.every(r => r.errors.length === 0));
        } finally { await second.close(); }
      });
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
