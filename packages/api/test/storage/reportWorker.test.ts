import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import type { ReportRepositories } from '../../src/services/storageReports.ts';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectAccountExport } from '../../src/services/storageExport.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { jobs } from './support/report-jobs.ts';
import { Worker } from 'node:worker_threads';
import { sql } from 'kysely';
import { openReportReader } from '../../src/storage/repositories/report-reader.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createReportRepositories } from '../../src/storage/repositories/reports.ts';
import { StorageReportRunner } from '../../src/services/storageReportRunner.ts';
import { collectReport } from '../../src/services/storageReports.ts';
import { formatReportJob, formatExportJob, type ReportJob, type ExportAssemblyJob } from '../../src/services/storageReportJobs.ts';
import { createTimerOperations, createTimerPublication } from '../../src/domain/timers.ts';
import { createTimeEntry } from '../../src/domain/timeEntries.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import type { Backend } from '../../src/storage/config.ts';

const job: ReportJob = { kind: 'app-report', filter: { startDate: '2026-10-01', endDate: '2026-10-31' }, grouping: 'tag', sub: 'description' };
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as Backend[]) {
  test(`${backend}: real worker equality, lifecycle, reader bounds and timer progress`, { timeout: 240000 }, async t => {
    const fixture = await disposableBackend(backend); t.after(() => fixture.cleanup());
    const c = await initializeDatabase(fixture.config); t.after(() => c.close());
    const operations = createTransactionRunner(c, db => ({ ...entryTimerFactory(backend)(db), ...createReportRepositories(db, backend), ...createTransferRepositories(db, backend) }));
    const user = await operations.transaction(r => r.users.createAccount(entryAccount('worker')));
    const wid = user.defaultWorkspaceId;
    const publish = createTimerPublication(async () => {});
    const timers = createTimerOperations(operations, publish);
    await operations.transaction(r => createTimeEntry(r, user, wid, { start: '2026-10-05T10:00:00Z', duration: 3600, description: 'Work' }, publish));
    const reader = await openReportReader(fixture.config);
    try {
      assert.deepEqual(formatReportJob(await collectReport(reader, user.id, wid, job.filter), job), formatReportJob(await collectReport(operations, user.id, wid, job.filter), job));
      await assert.rejects(reader.readSnapshot(r => r.users.updateAccount(user.id, { fullName: 'forbidden' })));
    } finally { await reader.close(); }
    const runner = new StorageReportRunner(fixture.config, operations, { maxQueue: 2 });
    t.after(() => runner.close());
    const expected = formatReportJob(await collectReport(operations, user.id, wid, job.filter), job);
    assert.deepEqual(await runner.run(user.id, wid, job), expected);
    const data = await collectReport(operations, user.id, wid, job.filter);
    for (const request of jobs(job.filter)) assert.deepEqual(await runner.run(user.id, wid, request), formatReportJob(data, request));
    const exported = await collectAccountExport(operations, user.id);
    for (const assembly of [
      { kind: 'export-json', exportedAt: '2026-10-30T12:00:00.000Z', filename: 'tokkl.json' },
      { kind: 'export-csv', range: {}, filename: 'tokkl.csv' },
    ] as ExportAssemblyJob[]) assert.deepEqual(await runner.assembleExport(exported, assembly), formatExportJob(exported, assembly));
    const worker = (runner as unknown as { worker: Worker }).worker;
    assert.ok(worker instanceof Worker);
    assert.equal(Number((await sql<{ n: number | string }>`select count(*) as n from storage_migrations`.execute(c.db)).rows[0]!.n), 3);
    await t.test('crash rejects current work and starts a fresh worker', async crash => {
      // Hold delivery so the one-row report cannot finish before termination.
      // The runner still assigns the job to this real worker and handles its exit.
      const delivery = crash.mock.method(worker, 'postMessage', () => {});
      const failed = assert.rejects(runner.run(user.id, wid, job), /Report worker stopped/);
      assert.equal(delivery.mock.callCount(), 1);
      await worker.terminate(); await failed;
      assert.deepEqual(await runner.run(user.id, wid, job), expected);
      assert.notEqual((runner as unknown as { worker: Worker }).worker, worker);
    });
    await t.test('queued cancellation, running cancellation, overload and restart', async () => {
      const abort = new AbortController();
      const first = runner.run(user.id, wid, job);
      const cancelled = runner.run(user.id, wid, job, { signal: abort.signal });
      const observed = assert.rejects(cancelled, /Report cancelled/); abort.abort(); await observed;
      assert.deepEqual(await first, expected);
      const active = new AbortController();
      const a = assert.rejects(runner.run(user.id, wid, job, { signal: active.signal }), /Report cancelled/);
      const b = runner.run(user.id, wid, job);
      await assert.rejects(runner.run(user.id, wid, job), /Report queue is full/);
      active.abort(); await a; assert.deepEqual(await b, expected);
    });
    // Actual CPU formatting over a real history, with timer domain operations during that phase.
    const history = Array.from({ length: 18000 }, (_, i) => ({ user_id: user.id, workspace_id: wid, project_id: null, task_id: null,
      description: `history ${i}`, start: '2026-10-05T10:00:00.000Z', stop: '2026-10-05T11:00:00.000Z', billable: 1,
      duronly: 0, all_day: 0, deleted_at: null, created_with: 'test', created_at: '2026-10-05T10:00:00.000Z', updated_at: '2026-10-05T11:00:00.000Z' }));
    for (let i = 0; i < history.length; i += 100) await c.db.insertInto('time_entries').values(history.slice(i, i + 100)).execute();
    await runner.close();
    let formatted!: () => void;
    const formatting = new Promise<void>(resolve => { formatted = resolve; });
    const heavy = new StorageReportRunner(fixture.config, operations, { onPhase: phase => { if (phase === 'formatting') formatted(); } });
    t.after(() => heavy.close());
    let finished = false;
    const started = performance.now();
    const result = heavy.run(user.id, wid, { kind: 'app-detailed-csv', filter: job.filter, sort: 'description', dir: 'asc', durationFormat: 'improved' }).then(r => { finished = true; return r; });
    await formatting;
    const timerStarted = performance.now();
    await operations.transaction(r => createTimeEntry(r, user, wid, { start: '2026-10-20T12:00:00Z', duration: -1, description: 'live timer' }, publish));
    const state = await timers.getTimerState(user.id);
    assert.equal(state.running_entry?.description, 'live timer');
    const overlapped = !finished;
    const timerMs = performance.now() - timerStarted;
    const body = await result;
    assert.equal(body.body.split('\r\n').length, 18003);
    console.log(JSON.stringify({ backend, rows: 18001, timerMs, reportMs: performance.now() - started, timerCompletedDuringFormatting: overlapped }));
    assert.ok(overlapped, 'timer must make progress during actual worker formatting');
    // Reader pools reuse one session across jobs and close it before returning from close().
    const sessions = async () => {
      if (backend === 'sqlite') return 0;
      const result = await sql.raw<{ n: string | number }>(backend === 'postgres'
        ? "select count(*) as n from pg_stat_activity where datname=current_database() and application_name='tokkl' and pid<>pg_backend_pid()"
        : 'select count(*) - 1 as n from information_schema.processlist where db=database()').execute(c.db);
      return Number(result.rows[0]!.n);
    };
    assert.equal(await sessions(), backend === 'sqlite' ? 0 : 1);
    const oldWorker = (heavy as unknown as { worker: Worker }).worker;
    const exit = once(oldWorker, 'exit');
    const duringClose = assert.rejects(heavy.run(user.id, wid, job), /Report runner is closed/);
    const queuedClose = assert.rejects(heavy.run(user.id, wid, job), /Report runner is closed/);
    await heavy.close(); await Promise.all([duringClose, queuedClose]); await exit;
    assert.equal(await sessions(), 0);
    await assert.rejects(heavy.run(user.id, wid, job), /Report runner is closed/);
  });
}
test('memory SQLite stays inline; reader startup never creates or migrates a file', async t => {
  const config = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
  const c = await initializeDatabase(config); t.after(() => c.close());
  const operations = createTransactionRunner(c, db => ({ ...entryTimerFactory('sqlite')(db), ...createReportRepositories(db, 'sqlite'), ...createTransferRepositories(db, 'sqlite') }));
  const user = await operations.transaction(r => r.users.createAccount(entryAccount('inline')));
  const runner = new StorageReportRunner(config, operations); t.after(() => runner.close());
  assert.deepEqual(await runner.run(user.id, user.defaultWorkspaceId, job), formatReportJob(await collectReport(operations, user.id, user.defaultWorkspaceId, job.filter), job));
  assert.equal((runner as unknown as { worker: Worker | null }).worker, null);
  const exported = await collectAccountExport(operations, user.id);
  const withSecrets = { ...exported, user: { ...exported.user, passwordHash: 'private-hash', apiToken: 'private-token' } };
  const assembly = runner.assembleExport(withSecrets, { kind: 'export-json', exportedAt: '2026-10-30T12:00:00.000Z', filename: 'tokkl.json' });
  const work = (runner as unknown as { active: { work: { data: { user: object } } } }).active.work;
  assert.equal('passwordHash' in work.data.user, false);
  assert.equal('apiToken' in work.data.user, false);
  await assembly;
  await c.db.deleteFrom('workspace_users').where('user_id', '=', user.id).execute();
  await assert.rejects(runner.run(user.id, user.defaultWorkspaceId, job), error => {
    assert.equal((error as { status: number }).status, 403);
    assert.equal((error as Error).message, 'User does not have access to this resource.'); return true;
  });
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-report-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'missing', 'db.sqlite');
  const missing = new StorageReportRunner({ ...config, filename }, operations); t.after(() => missing.close());
  await assert.rejects(missing.run(user.id, user.defaultWorkspaceId, job), /Report worker stopped/);
  assert.equal(existsSync(join(dir, 'missing')), false);
  const empty = join(dir, 'empty.sqlite'); writeFileSync(empty, '');
  const before = readFileSync(empty);
  const unmigrated = new StorageReportRunner({ ...config, filename: empty }, operations); t.after(() => unmigrated.close());
  await assert.rejects(unmigrated.run(user.id, user.defaultWorkspaceId, job), /Report failed/);
  await unmigrated.close(); assert.deepEqual(readFileSync(empty), before);
});

test('an idle storage report worker lets its parent process exit', async () => {
  const result = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./support/reportIdleChild.ts', import.meta.url))], { timeout: 15000 });
  assert.equal(result.stdout, 'report json\n');
});

test('inline cancellation and shutdown await the actual memory snapshot release', async t => {
  const config = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
  const c = await initializeDatabase(config); t.after(() => c.close());
  const operations = createTransactionRunner(c, db => ({ ...entryTimerFactory('sqlite')(db), ...createReportRepositories(db, 'sqlite') }));
  const user = await operations.transaction(r => r.users.createAccount(entryAccount('held')));
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = { readSnapshot<T>(work: (r: ReportRepositories) => Promise<T>): Promise<T> {
    return operations.readSnapshot(async r => { const result = await work(r); entered(); await gate; return result; });
  } };
  const runner = new StorageReportRunner(config, source);
  const controller = new AbortController();
  const cancelled = assert.rejects(runner.run(user.id, user.defaultWorkspaceId, job, { signal: controller.signal }), /Report cancelled/);
  await reading; controller.abort(); await cancelled;
  let closed = false;
  const closing = runner.close().then(() => { closed = true; });
  await setImmediate(); assert.equal(closed, false);
  release(); await closing;
  await c.health();
});
