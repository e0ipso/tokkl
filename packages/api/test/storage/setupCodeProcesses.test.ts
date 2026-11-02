import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sha256 } from '../../src/auth/crypto.ts';
import { PASSWORD_WINDOW_MS, SETUP_CODE_LIMIT } from '../../src/auth/rateLimit.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { StorageConfig } from '../../src/storage/config.ts';
import { databaseUrl, startApi, type ApiProcess } from './support/apiProcess.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { rows } from './support/schemaAssertions.ts';

const PASSWORD = 'correct horse battery';
const CODE = '[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}';
const CREATOR_LINE = new RegExp(`No admin account yet\\. Open the web UI and use this setup code to create it: (${CODE})`);
const PENDING_LINE = 'No admin account yet. The setup code was printed in the log of the instance that created it. Run npm run setup:code to print a replacement.';
const COMPLETED = 'Setup has already been completed';
const WINDOW_SECONDS = PASSWORD_WINDOW_MS / 1000;
const recoveryEntrypoint = fileURLToPath(new URL('../../src/setupCode.ts', import.meta.url));
const run = promisify(execFile);

// A key set to undefined is left out of the child environment, so no fixed code reaches the process.
// Both names matter: config.ts also reads the legacy TIMETRACK_ prefix from the runner's environment.
const GENERATED_MODE = { TOKKL_SETUP_CODE: undefined, TIMETRACK_SETUP_CODE: undefined };

const setupWith = (proc: ApiProcess, code: string, email = 'ada@example.test') => fetch(`${proc.base}/api/app/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1' },
  body: JSON.stringify({ email, password: PASSWORD, fullname: 'Ada', timezone: 'Europe/Madrid', setup_code: code }),
});

async function expectStatus(response: Response, status: number, what: string): Promise<string> {
  const text = await response.text();
  assert.equal(response.status, status, `${what}: ${text}`);
  return text;
}

async function expectRefused(response: Response, what: string): Promise<void> {
  await expectStatus(response, 429, what);
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= WINDOW_SECONDS, `${what}: Retry-After ${response.headers.get('retry-after')}`);
}

/** The code the instance that created it printed. */
function printedCode(proc: ApiProcess): string {
  const code = proc.logs().match(CREATOR_LINE)?.[1];
  assert.ok(code, `no creator line in: ${proc.logs()}`);
  return code;
}

/**
 * startApi resolves on the listening line, and the setup notice follows it in the same write. The pipe can
 * deliver them separately, so wait for the notice, or give a quiet process time to show it would print one.
 */
async function settled(proc: ApiProcess, noticeExpected: boolean): Promise<ApiProcess> {
  const deadline = Date.now() + (noticeExpected ? 10000 : 1000);
  while (Date.now() < deadline && !(noticeExpected && proc.logs().includes('No admin account yet'))) await new Promise(resolve => setTimeout(resolve, 20));
  return proc;
}

const printsCreatorLine = (proc: ApiProcess) => CREATOR_LINE.test(proc.logs());
const printsPendingLine = (proc: ApiProcess) => proc.logs().includes(PENDING_LINE);

function assertNoCode(proc: ApiProcess, what: string): void {
  assert.doesNotMatch(proc.logs(), new RegExp(CODE), `${what}: a restart must not print a code`);
}

/** Runs the recovery command against the same database, with no fixed code in its environment. */
async function rotate(url: string, dir: string): Promise<string> {
  const { TOKKL_SETUP_CODE: _a, TIMETRACK_SETUP_CODE: _b, TOKKL_DATABASE: _c, TIMETRACK_DATABASE: _d, ...inherited } = process.env;
  const { stdout } = await run(process.execPath, [recoveryEntrypoint], { env: { ...inherited, TOKKL_DATABASE_URL: url, TOKKL_DATA_DIR: dir }, timeout: 60000 });
  const code = stdout.match(new RegExp(`^New setup code: (${CODE})\\. Earlier setup codes no longer work\\.$`, 'm'))?.[1];
  assert.ok(code, `no new code in: ${stdout}`);
  return code;
}

/** Table contents read straight from the database, bypassing both API processes. */
async function inspect(config: StorageConfig) {
  const connection = await initializeDatabase(config);
  try {
    const table = (name: string) => rows(connection.db, 'postgres', name);
    return {
      users: await table('users'),
      workspaces: await table('workspaces'),
      memberships: await table('workspace_users'),
      codes: await table('setup_codes'),
    };
  } finally {
    await connection.close();
  }
}

test('postgres: generated first-admin setup codes are shared by two API processes', { timeout: 480000 }, async t => {
  const fixture = await disposableBackend('postgres');
  const root = mkdtempSync(join(tmpdir(), 'tokkl-setup-code-'));
  const processes: ApiProcess[] = [];
  // Every child goes before the database does.
  t.after(async () => {
    for (const proc of processes) if (proc.child.exitCode === null) proc.child.kill('SIGTERM');
    await Promise.allSettled(processes.map(proc => new Promise<void>(resolve => proc.child.exitCode === null ? proc.child.once('exit', () => resolve()) : resolve())));
    await fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  /** An empty database with its own pair of data directories and no fixed setup code. */
  async function scenario(name: string) {
    const namespace = await fixture.namespace!();
    const url = databaseUrl(namespace.config);
    const dirs = { a: mkdtempSync(join(root, `${name}-a-`)), b: mkdtempSync(join(root, `${name}-b-`)) };
    const start = async (which: 'a' | 'b', noticeExpected = true) => {
      const proc = await startApi(url, dirs[which], GENERATED_MODE);
      processes.push(proc);
      return settled(proc, noticeExpected);
    };
    return { url, dir: dirs.a, config: namespace.config, start, cleanup: () => namespace.cleanup() };
  }

  await t.test('startup, hand-over between processes, restarts and completion', async () => {
    const s = await scenario('flow');
    const [a, b] = await Promise.all([s.start('a'), s.start('b')]);

    // Concurrent startup: one creator line, one pending notice, one stored hash.
    assert.equal([a, b].filter(printsCreatorLine).length, 1, `${a.logs()}\n${b.logs()}`);
    assert.equal([a, b].filter(printsPendingLine).length, 1, `${a.logs()}\n${b.logs()}`);
    const [creator, other] = printsCreatorLine(a) ? [a, b] : [b, a];
    assert.ok(!printsPendingLine(creator) && !printsCreatorLine(other));
    assertNoCode(other, 'the process that lost the race');
    const code = printedCode(creator);
    let state = await inspect(s.config);
    assert.equal(state.users.length, 0);
    assert.equal(state.codes.length, 1);
    const hash = String(state.codes[0]!.code_hash);
    assert.equal(hash, sha256(code));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, code);
    assert.ok(!JSON.stringify(state.codes).includes(code), 'the plaintext code is not stored');

    // The creator restarts before setup: same hash, no code printed.
    await creator.stop();
    const creatorAgain = await s.start(creator === a ? 'a' : 'b');
    assert.ok(printsPendingLine(creatorAgain) && !printsCreatorLine(creatorAgain));
    assertNoCode(creatorAgain, 'restart before setup');
    state = await inspect(s.config);
    assert.deepEqual(state.codes.map(row => row.code_hash), [hash]);

    // The creator's code, sent to the other process, creates the admin and clears the code.
    await expectStatus(await setupWith(other, code), 200, 'setup through the other process');
    state = await inspect(s.config);
    assert.equal(state.users.length, 1);
    assert.equal(state.workspaces.length, 1);
    assert.deepEqual(state.memberships.map(row => row.role), ['owner']);
    assert.equal(state.codes.length, 0);
    for (const proc of [creatorAgain, other]) {
      assert.match(await expectStatus(await setupWith(proc, code, 'second@example.test'), 403, 'second setup'), new RegExp(COMPLETED));
    }
    assert.equal((await inspect(s.config)).users.length, 1);

    // Restarting after setup prints nothing about setup and stores nothing.
    await creatorAgain.stop();
    await other.stop();
    const after = await s.start('a', false);
    assert.ok(!printsPendingLine(after) && !printsCreatorLine(after) && !after.logs().includes('No admin account yet'));
    assertNoCode(after, 'restart after setup');
    state = await inspect(s.config);
    assert.equal(state.codes.length, 0);
    assert.equal(state.users.length, 1);
    await after.stop();
    await s.cleanup();
  });

  await t.test('rotation: running processes reject the old code and one competing submission of the new code wins', async () => {
    const s = await scenario('rotate');
    const [a, b] = await Promise.all([s.start('a'), s.start('b')]);
    const first = printedCode(printsCreatorLine(a) ? a : b);

    // Each process has checked a code before the rotation, so process-local state could go stale.
    for (const proc of [a, b]) await expectStatus(await setupWith(proc, 'WRONG-BEFORE'), 403, 'wrong code before rotation');
    const second = await rotate(s.url, s.dir);
    assert.notEqual(second, first);
    let state = await inspect(s.config);
    assert.deepEqual(state.codes.map(row => row.code_hash), [sha256(second)]);

    // Neither running process was restarted, and both now reject the old code.
    for (const proc of [a, b]) await expectStatus(await setupWith(proc, first), 403, 'old code after rotation');
    assert.equal((await inspect(s.config)).users.length, 0);

    // Valid submissions race through both processes with different emails: one account only.
    const attempts = await Promise.all([0, 1, 2, 3].map(i => setupWith(i % 2 === 0 ? a : b, second, `racer${i}@example.test`)));
    const statuses = attempts.map(response => response.status).sort();
    assert.deepEqual(statuses, [200, 403, 403, 403], await Promise.all(attempts.map(response => response.clone().text())).then(texts => texts.join(' | ')));
    state = await inspect(s.config);
    assert.equal(state.users.length, 1);
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.codes.length, 0);
    await a.stop();
    await b.stop();
    await s.cleanup();
  });

  await t.test('limit: wrong codes alternating across processes share one limit that survives rotation and a restart', async () => {
    const s = await scenario('limit');
    const [a, b] = await Promise.all([s.start('a'), s.start('b')]);
    const first = printedCode(printsCreatorLine(a) ? a : b);
    const second = await rotate(s.url, s.dir);

    // Fail up to the limit, alternating between the processes; the old code counts as a wrong guess.
    await expectStatus(await setupWith(a, first), 403, 'old code on A');
    for (let i = 1; i < SETUP_CODE_LIMIT; i++) await expectStatus(await setupWith(i % 2 === 0 ? a : b, `WRONG-${i}`), 403, `wrong code ${i + 1}`);
    await expectRefused(await setupWith(a, 'WRONG-A'), 'wrong code past the limit on A');
    await expectRefused(await setupWith(b, 'WRONG-B'), 'wrong code past the limit on B');
    await expectRefused(await setupWith(b, second), 'the new code past the limit');

    // A restarted process reads the same shared limit.
    await a.stop();
    const again = await s.start('a');
    await expectRefused(await setupWith(again, 'WRONG-AGAIN'), 'wrong code after restart');
    await expectRefused(await setupWith(again, second), 'the new code after restart');
    const state = await inspect(s.config);
    assert.equal(state.users.length, 0);
    assert.deepEqual(state.codes.map(row => row.code_hash), [sha256(second)]);
    await again.stop();
    await b.stop();
    await s.cleanup();
  });
});
