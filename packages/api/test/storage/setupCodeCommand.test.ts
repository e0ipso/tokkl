import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sha256 } from '../../src/auth/crypto.ts';
import { loadConfig } from '../../src/config.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { insert, rows } from './support/schemaAssertions.ts';

const entrypoint = fileURLToPath(new URL('../../src/setupCode.ts', import.meta.url));
const codePattern = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const run = promisify(execFile);

interface Result { code: number | null; stdout: string; stderr: string }

async function command(env: NodeJS.ProcessEnv): Promise<Result> {
  // Neither setup-code name may leak in from the test runner's environment.
  const { TOKKL_SETUP_CODE: _a, TIMETRACK_SETUP_CODE: _b, TOKKL_DATABASE: _c, TIMETRACK_DATABASE: _d, ...inherited } = process.env;
  try {
    const result = await run(process.execPath, [entrypoint], { env: { ...inherited, ...env }, timeout: 30000 });
    return { code: 0, ...result };
  } catch (error) {
    const failed = error as { code: number | null; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

test('setup:code rotates the pending hash, refuses a configured code or a finished setup, and never listens', { timeout: 120000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-setup-code-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const url = `sqlite://${join(dir, 'tokkl.sqlite')}`;
  const env = { TOKKL_DATABASE_URL: url, TOKKL_DATA_DIR: dir };
  const { config } = loadConfig({ ...env });
  const read = async <T>(work: (db: Awaited<ReturnType<typeof initializeDatabase>>) => Promise<T>) => {
    const connection = await initializeDatabase(config.storage);
    try { return await work(connection); } finally { await connection.close(); }
  };
  const hashes = () => read(async c => (await rows(c.db, 'sqlite', 'setup_codes')).map(row => row.code_hash));

  // Holding the HTTP port proves the command never binds it: an attempt would fail with EADDRINUSE.
  const holder = createServer();
  holder.listen(0, '127.0.0.1');
  await once(holder, 'listening');
  t.after(() => { holder.close(); });
  const port = String((holder.address() as AddressInfo).port);
  const withPort = { ...env, PORT: port, HOST: '127.0.0.1' };

  const first = await command(withPort);
  assert.equal(first.code, 0, first.stderr);
  const firstCode = first.stdout.match(/^New setup code: (\S+)\. Earlier setup codes no longer work\.$/m)?.[1];
  assert.match(firstCode ?? '', codePattern);
  assert.doesNotMatch(first.stdout + first.stderr, /listening/);
  assert.deepEqual(await hashes(), [sha256(firstCode!)]);

  // A second run replaces the pending hash, so the first code stops matching.
  const second = await command(withPort);
  assert.equal(second.code, 0, second.stderr);
  const secondCode = second.stdout.match(/New setup code: (\S+)\./)?.[1];
  assert.match(secondCode ?? '', codePattern);
  assert.notEqual(secondCode, firstCode);
  assert.deepEqual(await hashes(), [sha256(secondCode!)]);

  // An explicit code controls setup, and the command neither prints nor stores anything.
  const configured = await command({ ...withPort, TOKKL_SETUP_CODE: 'FIXED-CODE' });
  assert.equal(configured.code, 1);
  assert.equal(configured.stdout, '');
  assert.match(configured.stderr, /TOKKL_SETUP_CODE is set, so it is the setup code\. Change that setting instead\./);
  assert.ok(!configured.stderr.includes('FIXED-CODE'));
  assert.deepEqual(await hashes(), [sha256(secondCode!)]);

  // Once an account exists the command refuses and leaves the stored hash alone.
  await read(c => insert(c.db, 'sqlite', 'users', { email: 'admin@example.test', password_hash: 'hash', api_token: 'token', created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z' }));
  const complete = await command(withPort);
  assert.equal(complete.code, 1);
  assert.equal(complete.stdout, '');
  assert.match(complete.stderr, /Setup is already complete\. An account exists, so there is no setup code to replace\./);
  assert.deepEqual(await hashes(), [sha256(secondCode!)]);
});

test('setup:code prints the startup path\'s redacted failure for storage errors', { timeout: 60000 }, async () => {
  const password = 'hunter2-not-for-logs';
  const result = await command({ TOKKL_DATABASE_URL: `postgres://tokkl:${password}@127.0.0.1:1/tokkl?sslmode=disable&connect_timeout_ms=1000` });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Setup code failed\. Check database configuration, supported schema and connectivity\./);
  assert.ok(!result.stderr.includes(password));

  const invalid = await command({ TOKKL_DATABASE_URL: 'sqlite:///tmp/x.sqlite', TOKKL_TRUST_PROXY: 'nonsense' });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Setup code failed\. Invalid TOKKL_TRUST_PROXY/);
});
