import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { createStorageImports } from '../../src/services/storageImportJson.ts';
import { buildJsonExport, buildCsvExport } from '../../src/services/storageExport.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: exact partial JSON restore, dry run and duplicate import`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => ({ ...entryTimerFactory(backend)(db), ...createTransferRepositories(db, backend) }));
    const events: unknown[] = [], publish = createTimerPublication(async (id, state) => { events.push([id, state]); });
    const imports = createStorageImports(runner, publish);
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('transfer')));
      const data = { format: 'tokkl-export', clients: [{ id: 1, name: ' ACME ', archived: true }],
        projects: [{ id: 2, name: 'Site', client_id: 1, active: false }],
        tasks: [{ id: 3, name: 'Work', project_id: 2, estimated_seconds: 1.5 }], tags: [{ id: 4, name: 'x' }],
        time_entries: [{ id: 5, start: 'bad' }, { id: 6, start: '2026-10-01T08:00:07Z', stop: '2026-10-01T08:31:45Z', project_id: 2, task_id: 3, tag_ids: [4] }] };
      const before = await runner.readSnapshot(ctx => ctx.transfers.exportAccount(user.id));
      const dry = await imports.importJsonExport(user.id, data, { dryRun: true });
      assert.deepEqual([dry.clients, dry.projects, dry.tasks, dry.tags, dry.time_entries], [1, 1, 1, 1, 1]);
      assert.equal(dry.errors[0]?.id, 5);
      assert.deepEqual(await runner.readSnapshot(ctx => ctx.transfers.exportAccount(user.id)), before);
      assert.deepEqual(events, []);
      const first = await imports.importJsonExport(user.id, data, { dryRun: false });
      assert.equal(first.time_entries, 1);
      const twice = await imports.importJsonExport(user.id, data, { dryRun: false });
      assert.deepEqual([twice.clients, twice.projects, twice.tasks, twice.tags, twice.time_entries, twice.skipped_duplicates], [0, 0, 0, 0, 0, 1]);
      const output = await buildJsonExport(runner, user.id);
      assert.equal(output.clients[0]?.archived, true); assert.equal(output.projects[0]?.active, false);
      assert.equal(output.tasks[0]?.estimated_seconds, 1.5);
      assert.equal(output.time_entries[0]?.start, '2026-10-01T08:00:07+00:00');
      assert.equal(output.time_entries[0]?.duration, 1898);
      assert.ok(!JSON.stringify(output).includes('token-transfer'));
      assert.match(await buildCsvExport(runner, user.id, {}), /08:00:07/);
      const spaced = { ...data, time_entries: [
        { id: 7, description: 'Retain trailing space', start: '2026-10-01T08:00:07Z', stop: '2026-10-01T08:31:45Z', project_id: 2 },
        { id: 8, description: 'Retain trailing space ', start: '2026-10-01T08:00:07Z', stop: '2026-10-01T08:31:45Z', project_id: 2 },
      ] };
      const distinct = await imports.importJsonExport(user.id, spaced, { dryRun: false });
      assert.equal(distinct.time_entries, 2);
      assert.equal(distinct.skipped_duplicates, 0);
      const repeated = await imports.importJsonExport(user.id, spaced, { dryRun: false });
      assert.equal(repeated.time_entries, 0);
      assert.equal(repeated.skipped_duplicates, 2);
      assert.deepEqual((await buildJsonExport(runner, user.id)).time_entries
        .filter(e => typeof e.description === 'string' && e.description.startsWith('Retain trailing space')).map(e => e.description).sort(),
      ['Retain trailing space', 'Retain trailing space ']);
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
