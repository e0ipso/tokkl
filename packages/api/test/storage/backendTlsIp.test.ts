import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import { openReadConnection } from '../../src/storage/connections.ts';
import { StorageReportRunner } from '../../src/services/storageReportRunner.ts';
import { collectReport } from '../../src/services/storageReports.ts';
import { formatReportJob, type ReportJob } from '../../src/services/storageReportJobs.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryAccount } from './support/entry-timer.ts';

for (const backend of ['postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: verify-full accepts a trusted certificate with the requested IP SAN`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend, { tls: true, identity: 'ip' }); t.after(() => fixture.cleanup());
    assert.ok(fixture.config.backend !== 'sqlite'); assert.equal(fixture.config.host, '127.0.0.1'); assert.equal(fixture.config.tls.mode, 'verify-full');
    const c = await initializeDatabase(fixture.config), storage = createStorage(c); t.after(() => storage.close());
    await c.health();
    const user = await storage.transaction(ctx => ctx.users.createAccount(entryAccount('ip-san')));
    const reader = await openReadConnection(fixture.config);
    try { assert.equal((await sql<{ n: string | number }>`select count(*) as n from users`.execute(reader.db)).rows[0]!.n.toString(), '1'); }
    finally { await reader.close(); }
    const job: ReportJob = { kind: 'app-report', filter: { startDate: '2026-10-01', endDate: '2026-10-31' }, grouping: 'tag', sub: 'description' };
    const runner = new StorageReportRunner(fixture.config, storage);
    try { assert.deepEqual(await runner.run(user.id, user.defaultWorkspaceId, job), formatReportJob(await collectReport(storage, user.id, user.defaultWorkspaceId, job.filter), job)); }
    finally { await runner.close(); }
    console.log(`${backend}: actual IP-SAN writer, reader and report worker succeeded with full certificate verification`);
  });
}
