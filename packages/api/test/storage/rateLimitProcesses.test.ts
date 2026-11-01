import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ACCOUNT_ADDRESS_LIMIT, PASSWORD_WINDOW_MS, SETUP_CODE_LIMIT } from '../../src/auth/rateLimit.ts';
import { databaseUrl, startApi, type ApiProcess } from './support/apiProcess.ts';
import { disposableBackend } from './support/disposableBackend.ts';

const EMAIL = 'ada@example.test';
const PASSWORD = 'correct horse battery';
const WINDOW_SECONDS = PASSWORD_WINDOW_MS / 1000;

const post = (proc: ApiProcess, path: string, body: unknown) => fetch(proc.base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1' },
  body: JSON.stringify(body),
});
const setupWith = (proc: ApiProcess, code: string) => post(proc, '/api/app/setup', { email: EMAIL, password: PASSWORD, fullname: 'Ada', timezone: 'Europe/Madrid', setup_code: code });
const login = (proc: ApiProcess, password: string) => post(proc, '/api/app/login', { email: EMAIL, password });

async function expectStatus(response: Response, status: number, what: string): Promise<void> {
  const text = await response.text();
  assert.equal(response.status, status, `${what}: ${text}`);
}

/** A refusal from the limiter: 429 with a whole number of seconds inside the window. */
async function expectRefused(response: Response, what: string): Promise<void> {
  await expectStatus(response, 429, what);
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= WINDOW_SECONDS, `${what}: Retry-After ${response.headers.get('retry-after')}`);
}

test('postgres: failure limits are shared by two API processes and survive a restart', { timeout: 240000 }, async t => {
  const fixture = await disposableBackend('postgres');
  assert.ok(fixture.config.backend === 'postgres');
  const root = mkdtempSync(join(tmpdir(), 'tokkl-limits-'));
  const processes: ApiProcess[] = [];
  // Every child goes before the database does.
  t.after(async () => {
    for (const proc of processes) if (proc.child.exitCode === null) proc.child.kill('SIGTERM');
    await Promise.allSettled(processes.map(proc => new Promise<void>(resolve => proc.child.exitCode === null ? proc.child.once('exit', () => resolve()) : resolve())));
    await fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  });
  const start = async (url: string, name: string) => {
    const proc = await startApi(url, mkdtempSync(join(root, `${name}-`)));
    processes.push(proc);
    return proc;
  };

  await t.test('setup codes: wrong codes sent to A and B count toward one limit', async () => {
    // Setup stays incomplete here, so this case gets its own database.
    const namespace = await fixture.namespace!();
    const url = databaseUrl(namespace.config);
    const a = await start(url, 'setup-a');
    const b = await start(url, 'setup-b');
    for (let i = 0; i < SETUP_CODE_LIMIT; i++) {
      await expectStatus(await setupWith(i % 2 === 0 ? a : b, `WRONG-${i}`), 403, `wrong setup code ${i + 1}`);
    }
    await expectRefused(await setupWith(a, 'WRONG-A'), 'wrong setup code past the limit on A');
    await expectRefused(await setupWith(b, 'WRONG-B'), 'wrong setup code past the limit on B');
    await expectRefused(await setupWith(b, 'TEST-CODE'), 'correct setup code past the limit');
    await a.stop();
    await b.stop();
    await namespace.cleanup();
  });

  const url = databaseUrl(fixture.config);
  let a: ApiProcess | undefined, b: ApiProcess | undefined;

  await t.test('passwords: wrong passwords sent to A and B count toward one account limit', async () => {
    a = await start(url, 'login-a');
    await expectStatus(await setupWith(a, 'TEST-CODE'), 200, 'setup');
    b = await start(url, 'login-b');
    await expectStatus(await login(b, PASSWORD), 200, 'correct password before any failure');
    for (let i = 0; i < ACCOUNT_ADDRESS_LIMIT; i++) {
      await expectStatus(await login(i % 2 === 0 ? a : b, `wrong ${i}`), 403, `wrong password ${i + 1}`);
    }
    await expectRefused(await login(a, 'wrong on A'), 'wrong password past the limit on A');
    await expectRefused(await login(b, 'wrong on B'), 'wrong password past the limit on B');
    await expectRefused(await login(a, PASSWORD), 'correct password past the limit on A');
    await expectRefused(await login(b, PASSWORD), 'correct password past the limit on B');
  });

  await t.test('restart: a new process on the same database still refuses the blocked account', async () => {
    assert.ok(a && b, 'A and B ran the password case');
    await a.stop();
    await b.stop();
    const c = await start(url, 'login-c');
    await expectRefused(await login(c, 'wrong on C'), 'wrong password after restart');
    await expectRefused(await login(c, PASSWORD), 'correct password after restart');
    await c.stop();
  });
});
