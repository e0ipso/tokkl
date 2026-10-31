import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { disposableBackend } from './support/disposableBackend.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { initializeDatabase, validateEngine } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';

for (const backend of ['mysql', 'mariadb'] as const) {
  test(`${backend}: actual startup refuses the other engine version line before migrating or falling back`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend); t.after(() => fixture.cleanup());
    const config = fixture.config;
    assert.ok(config.backend === 'mysql' || config.backend === 'mariadb');
    const dir = mkdtempSync(join(tmpdir(), 'tokkl-version-refusal-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const otherBackend = backend === 'mysql' ? 'mariadb' : 'mysql';
    const url = `${otherBackend}://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?sslmode=disable&connect_timeout_ms=1000`;
    const c = await openConnection<PhysicalDatabase>(config); t.after(() => c.close());
    console.log(`${backend} refused version line under ${otherBackend} selector: ${await validateEngine(c)}`);
    const tables = async () => (await sql<{ name: string }>`select table_name as name from information_schema.tables where table_schema=database()`.execute(c.db)).rows;
    assert.deepEqual(await tables(), []);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/index.ts', import.meta.url))], {
      env: { ...process.env, TOKKL_DATABASE_URL: url, TOKKL_DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0', TOKKL_SETUP_CODE: 'TEST-CODE' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', b => { logs += String(b); }); child.stderr.on('data', b => { logs += String(b); });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      assert.equal(await new Promise<number | null>(r => child.once('exit', r)), 1);
      assert.match(logs, /Startup failed\. Check database configuration, supported schema and connectivity\./);
      assert.ok(!logs.includes(config.password)); assert.ok(!logs.includes(url)); assert.doesNotMatch(logs, /tokkl listening/);
      assert.deepEqual(readdirSync(dir), []); assert.deepEqual(await tables(), []);
    } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill('SIGKILL'); }
    const valid = await initializeDatabase(config);
    try { assert.equal((await valid.db.selectFrom('storage_migrations').selectAll().execute()).length, 3); }
    finally { await valid.close(); }
  });
}
