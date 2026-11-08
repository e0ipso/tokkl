import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createReportRepositories } from '../../src/storage/repositories/reports.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import type { Backend } from '../../src/storage/config.ts';
import type { StorageConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { ApplicationError } from '../../src/lib/errors.ts';
import { ReportRunner } from '../../src/services/reportRunner.ts';
import { runExport } from '../fixtures/reportRunner.ts';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_BYTES_AHEAD,
  runExportJob,
  type ExportAssemblyJob,
} from '../../src/services/exportJobs.ts';
import { collectAccountExport, exportBody } from '../fixtures/exports.ts';
import { oracleExportBody } from '../fixtures/exportOracle.ts';
import { entryAccount, entryTimerFactory } from './support/entry-timer.ts';
import { disposableBackend } from './support/disposableBackend.ts';

/** Deterministic pseudo-random numbers, so every backend gets the same history. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: <T>(values: readonly T[]): T => values[int(values.length)]! };
}

/** Descriptions CSV must quote, JSON must escape, and ones that differ only in case or accents. */
const DESCRIPTIONS = ['plain', 'Plain', 'ålpha', 'a, b', 'say "hi"', 'line\nbreak', '', 'tab\there', '😀 emoji', '\\'];
/** More than two batches, so pages meet at batch boundaries. */
const ENTRIES = 2 * EXPORT_BATCH_SIZE + 137;

const ASSEMBLIES: ExportAssemblyJob[] = [
  { kind: 'export-json', exportedAt: '2026-11-01T09:00:00.000Z', filename: 'tokkl.json' },
  { kind: 'export-csv', range: {}, filename: 'tokkl.csv' },
  { kind: 'export-csv', range: { from: '2026-10-05', to: '2026-10-20' }, filename: 'tokkl.csv' },
  { kind: 'export-csv', range: { to: '2026-10-10' }, filename: 'tokkl.csv', durationFormat: 'classic' },
  { kind: 'export-csv', range: { from: '2026-10-25' }, filename: 'tokkl.csv', durationFormat: 'decimal' },
  { kind: 'export-csv', range: { from: '2027-01-01' }, filename: 'tokkl.csv' },
];

function runnerFor(connection: StorageConnection<PhysicalDatabase>, backend: Backend) {
  return createTransactionRunner(connection, db => ({
    ...entryTimerFactory(backend)(db),
    ...createReportRepositories(db, backend),
    ...createTransferRepositories(db, backend),
  }));
}
type Operations = ReturnType<typeof runnerFor>;

/** An account with two workspaces, catalogs and `entries` entries that tie on start, run, and sit in the trash. */
async function seedAccount(
  connection: StorageConnection<PhysicalDatabase>,
  operations: Operations,
  name: string,
  timezone: string,
  entries: number,
  seed: number,
  description = (rand: ReturnType<typeof random>) => rand.pick(DESCRIPTIONS),
) {
  const rand = random(seed);
  const seeded = await operations.transaction(async ctx => {
    const user = await ctx.users.createAccount({ ...entryAccount(name), timezone });
    const wid = user.defaultWorkspaceId;
    const second = await ctx.workspaces.create(`${name} second`);
    await ctx.workspaces.addMember({ userId: user.id, workspaceId: second.id, role: 'member' });
    const acme = await ctx.clients.create({ workspaceId: wid, name: 'ACME, Inc.', notes: null, archived: false });
    const project = (workspaceId: number, projectName: string, clientId: number | null) =>
      ctx.projects.create({
        workspaceId,
        clientId,
        name: projectName,
        color: '#0b83d9',
        active: true,
        isPrivate: true,
        billable: true,
        estimatedHours: null,
        rate: 40,
        currency: 'EUR',
        fixedFee: null,
        startDate: null,
        endDate: null,
        template: false,
      });
    const projects = [await project(wid, 'Website "v2"', acme.id), await project(second.id, 'Other', null)];
    const task = await ctx.tasks.create({
      workspaceId: wid,
      projectId: projects[0]!.id,
      name: 'Design',
      active: true,
      estimatedSeconds: null,
    });
    const tags = await ctx.tags.resolveNames(wid, ['zebra', 'Alpha', 'éclair']);
    return { user, wid, second: second.id, projects, task, tags };
  });
  const { user, wid, second, projects, task } = seeded;
  const first = Date.UTC(2026, 9, 1, 6);
  const starts: number[] = [];
  const rows = Array.from({ length: entries }, (_, i) => {
    const start =
      starts.length && rand.next() < 0.15 ? rand.pick(starts) : first + rand.int(30 * 24 * 60) * 60_000 + rand.int(999);
    starts.push(start);
    const inSecond = rand.next() < 0.2;
    // The running entry has no project: a project's tracked time counts it up to now.
    const project = i === 3 ? null : inSecond ? projects[1]! : rand.pick([projects[0]!, null]);
    return {
      user_id: user.id,
      workspace_id: inSecond ? second : wid,
      project_id: project?.id ?? null,
      task_id: project?.id === projects[0]!.id && rand.next() < 0.5 ? task.id : null,
      description: description(rand),
      start: new Date(start).toISOString(),
      // A running entry: the JSON export lists it, the CSV export skips it.
      stop: i === 3 ? null : new Date(start + rand.int(5 * 3_600_000)).toISOString(),
      billable: Number(rand.next() < 0.5),
      duronly: 0,
      all_day: Number(rand.next() < 0.05),
      deleted_at: rand.next() < 0.04 ? '2026-11-01T00:00:00.000Z' : null,
      created_with: 'test',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    };
  });
  for (let i = 0; i < rows.length; i += 100)
    await connection.db
      .insertInto('time_entries')
      .values(rows.slice(i, i + 100))
      .execute();
  const ids = await connection.db.selectFrom('time_entries').select('id').where('user_id', '=', user.id).execute();
  const labels = ids.flatMap(({ id }) =>
    seeded.tags.filter(() => rand.next() < 0.3).map(tag => ({ time_entry_id: Number(id), tag_id: tag.id })),
  );
  for (let i = 0; i < labels.length; i += 200)
    await connection.db
      .insertInto('time_entry_tags')
      .values(labels.slice(i, i + 200))
      .execute();
  return user;
}

/** The body `runner` streams for `userId`'s export, and the size of each piece. */
async function streamed(runner: ReportRunner, userId: number, assembly: ExportAssemblyJob) {
  const chunks: string[] = [];
  await runExport(runner, userId, assembly, async chunk => {
    chunks.push(chunk);
  });
  return chunks.join('');
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as Backend[]) {
  test(`${backend}: streamed exports write the bytes of the whole-projection exports`, { timeout: 900000 }, async t => {
    const fixture = await disposableBackend(backend);
    t.after(() => fixture.cleanup());
    const connection = await initializeDatabase(fixture.config);
    t.after(() => connection.close());
    const operations = runnerFor(connection, backend);
    const users = [
      await seedAccount(connection, operations, 'export-a', 'Europe/Madrid', ENTRIES, 20261108),
      await seedAccount(connection, operations, 'export-b', 'America/New_York', 3, 7),
      await seedAccount(connection, operations, 'export-empty', 'UTC', 0, 1),
    ];
    // The worker reads through its own reader; the inline job reads on this connection.
    const runner = new ReportRunner(fixture.config, operations);
    t.after(() => runner.close());
    for (const user of users) {
      const projection = await collectAccountExport(operations, user.id);
      for (const assembly of ASSEMBLIES) {
        const expected = oracleExportBody(projection, assembly);
        const label = `${user.fullName} ${JSON.stringify(assembly)}`;
        assert.equal(await exportBody(operations, user.id, assembly), expected, `inline ${label}`);
        assert.equal(await streamed(runner, user.id, assembly), expected, `worker ${label}`);
      }
    }
  });
}

test('an invalid CSV range fails before the export writes anything', async t => {
  const config = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
  const connection = await initializeDatabase(config);
  t.after(() => connection.close());
  const operations = runnerFor(connection, 'sqlite');
  const user = await seedAccount(connection, operations, 'export-range', 'UTC', 3, 3);
  for (const [range, message] of [
    [{ from: '2026-13-01' }, 'Invalid start_date: expected YYYY-MM-DD'],
    [{ to: 'yesterday' }, 'Invalid end_date: expected YYYY-MM-DD'],
  ] as const) {
    let written = 0;
    await assert.rejects(
      runExportJob(
        operations,
        { userId: user.id, assembly: { kind: 'export-csv', range, filename: 'x' } },
        async () => {
          written++;
        },
      ),
      error => error instanceof ApplicationError && error.message === message,
    );
    assert.equal(written, 0);
  }
});

test('a worker export waits for its output to take what it sent', { timeout: 120000 }, async t => {
  const fixture = await disposableBackend('sqlite');
  t.after(() => fixture.cleanup());
  const connection = await initializeDatabase(fixture.config);
  t.after(() => connection.close());
  const operations = runnerFor(connection, 'sqlite');
  // About 4 MB of JSON: several times the bytes a worker may send ahead.
  const long = 'x'.repeat(2000);
  const user = await seedAccount(connection, operations, 'export-big', 'UTC', 2000, 11, () => long);
  const assembly: ExportAssemblyJob = { kind: 'export-json', exportedAt: '2026-11-01T09:00:00.000Z', filename: 'x' };
  const expected = oracleExportBody(await collectAccountExport(operations, user.id), assembly);
  assert.ok(Buffer.byteLength(expected) > 3 * EXPORT_BYTES_AHEAD);

  const runner = new ReportRunner(fixture.config, operations);
  t.after(() => runner.close());
  const chunks: string[] = [];
  const held: Array<() => void> = [];
  let largest = 0;
  let settled = false;
  const done = runExport(runner, user.id, assembly, chunk => {
    chunks.push(chunk);
    largest = Math.max(largest, Buffer.byteLength(chunk));
    return new Promise<void>(resolve => held.push(resolve));
  }).then(() => {
    settled = true;
  });
  // Hold every piece until the worker stops sending.
  let seen = -1;
  while (!chunks.length || seen !== chunks.length) {
    seen = chunks.length;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const ahead = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0);
  assert.ok(chunks.length > 0);
  assert.ok(ahead <= EXPORT_BYTES_AHEAD + largest, `${ahead} bytes went out before any was taken`);
  assert.ok(ahead < Buffer.byteLength(expected));
  assert.equal(settled, false);
  // Take the pieces as they come; the export settles only once the last one was taken.
  while (!settled) {
    for (const resolve of held.splice(0)) resolve();
    await setImmediate();
  }
  await done;
  assert.equal(chunks.join(''), expected);
});
