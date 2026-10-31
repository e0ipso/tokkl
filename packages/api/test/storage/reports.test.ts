import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { openConnection } from '../../src/storage/connections.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createReportRepositories } from '../../src/storage/repositories/reports.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { collectReport, formatReportEntries, type ReportFilter } from '../../src/services/storageReports.ts';
import { formatReportJob } from '../../src/services/storageReportJobs.ts';
import expectedReports from './support/report-expected.json' with { type: 'json' };
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import type { Backend } from '../../src/storage/config.ts';

import { range, jobs } from './support/report-jobs.ts';
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as Backend[]) {
  test(`${backend}: bounded report projections and every envelope match legacy reports`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    t.after(() => fixture.cleanup());
    const connection = await initializeDatabase(fixture.config);
    t.after(() => connection.close());
    let count = 0;
    const factory = (db: typeof connection.db) => ({ ...entryTimerFactory(backend)(db), ...createReportRepositories(db, backend) });
    const operations = createTransactionRunner(connection, factory);
    const seeded = await operations.transaction(async ctx => {
      const user = await ctx.users.createAccount({ ...entryAccount('reports'), timezone: 'Europe/Madrid' });
      const wid = user.defaultWorkspaceId;
      const ws = await ctx.workspaces.update(wid, { defaultCurrency: 'EUR', defaultHourlyRate: 50 });
      const c = await ctx.clients.create({ workspaceId: wid, name: 'ACME', notes: null, archived: false });
      const p = await ctx.projects.create({ workspaceId: wid, clientId: c.id, name: 'Website', color: '#123456', active: true,
        isPrivate: true, billable: true, estimatedHours: null, rate: 80, currency: 'USD', fixedFee: null, startDate: null, endDate: null, template: false });
      const task = await ctx.tasks.create({ workspaceId: wid, projectId: p.id, name: 'Design', active: true, estimatedSeconds: 1.5 });
      const tags = await ctx.tags.resolveNames(wid, ['zebra', 'Alpha', 'Éclair']);
      for (const [i, description] of ['Homepage, hero', 'Planning', '100%_\\literal', 'ÉÄ ASCII'].entries()) {
        const start = i === 1 ? '2026-10-24T22:00:00.000Z' : `2026-10-05T0${i + 6}:00:00.900Z`;
        await ctx.entries.create({ userId: user.id, workspaceId: wid, projectId: i === 1 ? null : p.id,
          taskId: i === 1 ? null : task.id, description, start, stop: new Date(Date.parse(start) + (i + 1) * 901100).toISOString(),
          billable: i !== 1, allDay: i === 1, durationOnly: true, createdWith: 'test', deletedAt: null, tagIds: i === 1 ? [] : tags.map(g => g.id) });
      }
      await ctx.entries.create({ userId: user.id, workspaceId: wid, projectId: p.id, taskId: task.id, description: 'epoch',
        start: '1969-12-31T23:59:59.900Z', stop: '1970-01-01T00:00:01.100Z', billable: true, allDay: false, durationOnly: false, createdWith: 'test', deletedAt: null, tagIds: [tags[0]!.id] });
      return { user, ws, p, task, tags };
    });
    // The retained legacy envelopes include this controlled fixture audit timestamp.
    await connection.db.updateTable('time_entries').set({ updated_at: '2026-10-30T12:01:39.000Z' }).execute();
    const filters: ReportFilter[] = [range, { ...range, rounding: 1, roundingMinutes: 15 }, { ...range, rounding: -1, roundingMinutes: 5 },
      { ...range, description: '%_\\' }, { ...range, description: 'é' }, { ...range, description: 'ascii' },
      { ...range, projectIds: [null] }, { ...range, clientIds: [seeded.p.clientId] }, { ...range, taskIds: [null, seeded.task.id] },
      { ...range, excludeProjectIds: [seeded.p.id] }, { ...range, excludeClientIds: [null] },
      { ...range, tagIds: [null, seeded.tags[0]!.id] }, { ...range, excludeTagIds: [seeded.tags[0]!.id] },
      { ...range, userIds: [999] }, { ...range, timeEntryIds: [1, 3], billable: true },
      { ...range, minDurationSeconds: 902, maxDurationSeconds: 3000 },
      { startDate: '1969-12-31', endDate: '1970-01-02', minDurationSeconds: 2, maxDurationSeconds: 2 },
    ];
    let expectedIndex = 0;
    for (const filter of filters) {
      const data = await collectReport(operations, seeded.user.id, seeded.ws.id, filter);
      for (const job of jobs(filter)) assert.deepEqual(formatReportJob(data, job), expectedReports[expectedIndex++], `${backend} ${job.kind} ${JSON.stringify(filter)}`);
    }
    await t.test('snapshot keeps joined metadata and ordered tags from the same committed version', async () => {
      const writer = await openConnection<PhysicalDatabase>(fixture.config); t.after(() => writer.close());
      const mutations = createTransactionRunner(writer, db => entryTimerFactory(backend)(db));
      let changed = false;
      const barrier = connection.db.withPlugin({ transformQuery(args) { return args.node; }, async transformResult(args) {
        if (!changed && args.result.rows.some(row => 'project_name' in row)) {
          changed = true;
          await mutations.transaction(async r => {
            await r.projects.update(seeded.ws.id, seeded.p.id, { name: 'Changed project' });
            await r.tags.rename(seeded.ws.id, seeded.tags[0]!.id, 'Changed tag');
          });
        }
        return args.result;
      } });
      const consistent = createTransactionRunner({ ...connection, db: barrier }, factory);
      const snapshot = await collectReport(consistent, seeded.user.id, seeded.ws.id, range);
      const entry = snapshot.entries.find(e => e.projectId === seeded.p.id)!;
      assert.equal(changed, true); assert.equal(entry.projectName, 'Website');
      assert.ok(entry.tags.some(g => g.name === seeded.tags[0]!.name));
      const fresh = await collectReport(operations, seeded.user.id, seeded.ws.id, range);
      assert.equal(fresh.entries.find(e => e.projectId === seeded.p.id)!.projectName, 'Changed project');
      assert.ok(fresh.entries.some(e => e.tags.some(g => g.name === 'Changed tag')));
    });
    // A history larger than the entry-list batching threshold still uses exactly two SELECTs.
    const more = Array.from({ length: 1201 }, (_, i) => ({ workspace_id: seeded.ws.id, user_id: seeded.user.id,
      project_id: seeded.p.id, task_id: null, description: `history ${i}`, start: '2026-10-01T00:00:00.000Z', stop: '2026-10-01T01:00:00.000Z',
      billable: 0, duronly: 0, all_day: 0, created_with: 'test', deleted_at: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }));
    for (let i = 0; i < more.length; i += 100) await connection.db.insertInto('time_entries').values(more.slice(i, i + 100)).execute();
    const selects = new Set<object>();
    const counted = connection.db.withPlugin({ transformQuery(args) { if (args.node.kind === 'SelectQueryNode') selects.add(args.queryId); return args.node; }, async transformResult(args) { if (selects.delete(args.queryId)) count++; return args.result; } });
    const bounded = createTransactionRunner({ ...connection, db: counted }, db => createReportRepositories(db, backend));
    const projections = await bounded.readSnapshot(r => r.reports.collect(seeded.user.id, seeded.ws.id, { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }));
    assert.equal(projections.length, 1205); assert.equal(count, 2);
    assert.equal(formatReportEntries(projections, seeded.user, seeded.ws, range).length, 1205);
    assert.equal((await sql`select count(*) as n from storage_migrations`.execute(connection.db)).rows.length, 1);
  });
}
