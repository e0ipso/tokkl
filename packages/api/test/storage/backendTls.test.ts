import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sql } from 'kysely';
import { Worker } from 'node:worker_threads';
import type { ServerConfig } from '../../src/storage/config.ts';
import { initializeDatabase, validateEngine } from '../../src/storage/migrations.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { createStorage } from '../../src/storage/index.ts';
import { openReportReader } from '../../src/storage/repositories/report-reader.ts';
import { StorageReportRunner } from '../../src/services/storageReportRunner.ts';
import { collectReport } from '../../src/services/storageReports.ts';
import { formatReportJob, type ReportJob } from '../../src/services/storageReportJobs.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryAccount } from './support/entry-timer.ts';

function selector(c: ServerConfig): string {
  assert.equal(c.tls.mode, 'verify-full');
  const ca = c.tls.mode === 'verify-full' ? c.tls.caFile! : '';
  return `${c.backend}://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}?sslmode=verify-full&sslrootcert=${encodeURIComponent(ca)}&connect_timeout_ms=1000`;
}
async function refusedStartup(config: ServerConfig) {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-tls-refusal-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/index.ts', import.meta.url))], {
    env: { ...process.env, TOKKL_DATABASE_URL: selector(config), TOKKL_DATA_DIR: dir, TOKKL_SETUP_CODE: 'TEST-CODE', PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', b => { logs += String(b); }); child.stderr.on('data', b => { logs += String(b); });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
  const start = performance.now();
  try {
    const exit = await new Promise<number | null>(r => child.once('exit', r));
    assert.equal(exit, 1); assert.ok(performance.now() - start < 10000);
    assert.ok(!logs.includes(config.password)); assert.ok(!logs.includes(selector(config)));
    assert.match(logs, /Startup failed\. Check database configuration, supported schema and connectivity\./); assert.doesNotMatch(logs, /tokkl listening/);
    assert.deepEqual(readdirSync(dir), [], 'TLS refusal cannot fall back to a new SQLite file');
  } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
}
const job: ReportJob = { kind: 'app-report', filter: { startDate: '2026-10-01', endDate: '2026-10-31' }, grouping: 'tag', sub: 'description' };
for (const backend of ['postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: authenticated verify-full handshakes and report reader/worker inheritance`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend, { tls: true });
    t.after(() => fixture.cleanup());
    assert.notEqual(fixture.config.backend, 'sqlite');
    const config = fixture.config as ServerConfig;
    const c = await initializeDatabase(config); const storage = createStorage(c);
    t.after(() => storage.close());
    console.log(`${backend} TLS actual engine: ${await validateEngine(c)}`);
    if (backend === 'postgres') {
      assert.equal((await sql<{ ssl: boolean }>`select ssl from pg_stat_ssl where pid=pg_backend_pid()`.execute(c.db)).rows[0]!.ssl, true);
    } else {
      const result = await sql.raw<{ Value: string }>("SHOW SESSION STATUS LIKE 'Ssl_cipher'").execute(c.db);
      assert.ok(result.rows[0]!.Value.length > 0, 'authenticated session negotiated an actual TLS cipher');
    }
    const user = await storage.transaction(ctx => ctx.users.createAccount(entryAccount('tls')));
    await storage.transaction(ctx => ctx.entries.create({ workspaceId: user.defaultWorkspaceId, userId: user.id, projectId: null, taskId: null,
      start: '2026-10-05T10:00:00.123Z', stop: '2026-10-05T11:00:00.456Z', description: 'TLS reader data', billable: true, allDay: false,
      durationOnly: false, createdWith: 'test', deletedAt: null, tagIds: [] }));
    const expected = formatReportJob(await collectReport(storage, user.id, user.defaultWorkspaceId, job.filter), job);
    const reader = await openReportReader(config);
    try {
      assert.deepEqual(formatReportJob(await collectReport(reader, user.id, user.defaultWorkspaceId, job.filter), job), expected);
      await assert.rejects(reader.readSnapshot(ctx => ctx.users.updateAccount(user.id, { fullName: 'forbidden' })));
    } finally { await reader.close(); }
    const runner = new StorageReportRunner(config, storage);
    try {
      assert.deepEqual(await runner.run(user.id, user.defaultWorkspaceId, job), expected);
      assert.ok((runner as unknown as { worker: Worker }).worker instanceof Worker, 'report executed in a real worker');
    } finally { await runner.close(); }
    for (const [label, invalid] of [
      ['untrusted CA', { ...config, tls: { mode: 'verify-full' as const, caFile: join(dirname(config.tls.mode === 'verify-full' ? config.tls.caFile! : ''), 'untrusted.pem') } }],
      ['wrong identity', { ...config, host: '127.0.0.1' }],
    ] as const) {
      await t.test(label, async () => {
        const start = performance.now();
        for (const open of [openConnection, openReportReader]) await assert.rejects((async () => { const unexpected = await open({ ...invalid, connectTimeoutMs: 1000 }); await unexpected.close(); })(), error => {
          assert.equal(String(error), `StorageConnectionError: Storage open failed (${backend})`); return true;
        });
        const broken = new StorageReportRunner({ ...invalid, connectTimeoutMs: 1000 }, storage);
        try { await assert.rejects(broken.run(user.id, user.defaultWorkspaceId, job), /Report worker stopped/); }
        finally { await broken.close(); }
        await refusedStartup(invalid);
        assert.ok(performance.now() - start < 15000, 'failed TLS startup and cleanup remain bounded');
        await c.health();
        console.log(`${backend}: ${label} refused by writer, reader, worker and actual startup`);
      });
    }
    assert.equal((await c.db.selectFrom('storage_migrations').selectAll().execute()).length, 3);
  });
}
