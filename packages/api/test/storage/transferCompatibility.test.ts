import assert from 'node:assert/strict';
import { test } from 'node:test';
import expectedTransfers from './support/transfer-expected.json' with { type: 'json' };
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { createStorageImports } from '../../src/services/storageImportJson.ts';
import { buildJsonExport, buildCsvExport, assembleJsonExport, assembleCsvExport } from '../../src/services/storageExport.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { deleteTimeEntry } from '../../src/domain/timeEntries.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';

function normalize(value: unknown, key = ''): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(v => normalize(v, key.endsWith('_ids') ? 'id' : ''));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, normalize(v,k)]));
  if (key === 'toggl_accounts_id') return '<string-id>';
  if (key === 'id' || key.endsWith('_id') || ['wid', 'uid', 'pid', 'tid', 'cid'].includes(key)) { assert.equal(typeof value, 'number'); return '<id>'; }
  return value;
}
const csv = ['User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags',
  'Me,me@example.com,ACME,Website,Design,"Homepage, hero",Yes,2026-10-05,10:01:20,2026-10-05,11:31:40,01:30:20,"zebra, Alpha"',
  'Me,me@example.com,,,,Invalid date,No,not-a-date,08:00:00,,,00:10:00,',
  'Me,me@example.com,,,,No times,No,2026-10-25,,2026-10-25,,00:45:00,',
  'Me,me@example.com,,,,\'=cmd(),No,2026-10-26,09:00:01,,,0:10:03,'].join('\n');
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: complete public import/export values match controlled legacy fixtures`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => ({ ...entryTimerFactory(backend)(db), ...createTransferRepositories(db, backend) }));
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T12:00:00.000Z') });
    const publish = createTimerPublication(async () => {}), imports = createStorageImports(runner, publish);
    let expectedIndex = 0;
    const legacy = { request: async (..._args: unknown[]) => { const value=expectedTransfers[expectedIndex++]!.body; return {json:async()=>value,text:async()=>String(value)}; } };
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount({ ...entryAccount('me', 'admin'), email: 'me@example.com', fullName: 'Test User', timezone: 'Europe/Madrid', preferences: { pg_time_zone_name: 'Europe/Madrid' } }));
      for (const dryRun of [true, false]) {
        const expected = await (await legacy.request('POST', `/api/app/import/toggl-csv${dryRun ? '?dry_run=true' : ''}`, csv, { 'content-type': 'text/csv' })).json();
        assert.deepEqual(await imports.importTogglCsv(user.id, csv, { dryRun }), expected);
      }
      const oldJson = await (await legacy.request('GET', '/api/app/export.json')).json();
      assert.deepEqual(normalize(await buildJsonExport(runner, user.id)), normalize(oldJson));
      for (const range of [{}, { from: '2026-10-25', to: '2026-10-26' }]) {
        const query = new URLSearchParams(); if (range.from) query.set('start_date', range.from); if (range.to) query.set('end_date', range.to);
        assert.equal(await buildCsvExport(runner, user.id, range), await (await legacy.request('GET', `/api/app/export.csv?${query}`)).text());
      }
      const file = { format: 'timetrack-export', user: { timezone: 'America/New_York' },
        clients: [{ id: 1, name: 'Archive', archived: true }],
        projects: [{ id: 2, name: 'Archived', client_id: 1, active: false, color: '#123456', rate: 42.5, currency: 'eur', start_date: '2031-05-20', is_private: false }],
        tasks: [{ id: 3, project_id: 2, name: 'Kept', active: false, estimated_seconds: 1.5 }, { id: 4, project_id: 2, name: '' }],
        tags: [{ id: 5, name: 'label' }],
        time_entries: [{ id: 6, description: 'missing project', project_id: 99, start: '2026-10-27T00:00:00Z' },
          { id: 7, description: 'linked', project_id: 2, task_id: 3, tag_ids: [5], start: '2026-10-28T08:00:07.123Z', stop: '2026-10-28T08:13:43.987Z' },
          { id: 8, description: 'all day', all_day: true, start: '2026-10-25T04:00:00Z', stop: '2026-10-25T05:01:01Z' },
          { id: 10, project_id: 2, task_id: 3, description: 'pre epoch', start: '1969-12-31T23:59:58.700Z', stop: '1970-01-01T00:00:01.200Z' },
          { id: 9, description: 'trash', server_deleted_at: '2026-10-30T08:00:00Z' }] };
      for (const dryRun of [true, false, false]) {
        const expected = await (await legacy.request('POST', `/api/app/import/json${dryRun ? '?dry_run=true' : ''}`, file)).json();
        assert.deepEqual(await imports.importJsonExport(user.id, file, { dryRun }), expected);
      }
      const out = await buildJsonExport(runner, user.id);
      assert.deepEqual(normalize(out), normalize(await (await legacy.request('GET', '/api/app/export.json')).json()));
      assert.equal(out.time_entries.find(e => e.description === 'all day')?.start, '2026-10-24T22:00:00+00:00');
      assert.ok(!out.time_entries.some(e => e.description === 'trash'));
      const projection = await runner.readSnapshot(ctx => ctx.transfers.exportAccount(user.id));
      assert.deepEqual(assembleJsonExport(structuredClone(projection)), out);
      assert.equal(assembleCsvExport(structuredClone(projection), {}), await buildCsvExport(runner, user.id, {}));
      const removed = projection.entries[0]!;
      await runner.transaction(ctx => deleteTimeEntry(ctx, user.id, user.defaultWorkspaceId, removed.id, publish));
      assert.ok(!(await buildJsonExport(runner, user.id)).time_entries.some(e => e.id === removed.id));
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
