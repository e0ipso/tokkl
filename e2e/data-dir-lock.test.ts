import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimDataDir } from './data-dir-lock.ts';

// The lock guards a preset TOKKL_E2E_DATA_DIR (see e2e/data-dir-lock.ts). These tests run under
// `node --test` from `npm test`, not under Playwright: they need no browser and no server.

/** A fresh directory for one test, deleted when the test ends. */
function sandbox(t: { after: (fn: () => void) => void }): { root: string; dataDir: string; lockPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'tokkl-lock-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, 'data');
  return { root, dataDir, lockPath: `${dataDir}.lock` };
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const pid = Number(child.stdout);
  assert.ok(Number.isInteger(pid) && pid > 0, `no pid from ${JSON.stringify(child.stdout)}`);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `pid ${pid} was reused`);
  return pid;
}

function holder(lockPath: string): { pid: number; host: string; id?: string } {
  return JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; host: string; id?: string };
}

function guardPath(lockPath: string, content: string): string {
  return `${lockPath}.recover-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`;
}

/** Files next to the data directory other than `keep`: drafts, guards or locks left behind. */
function leftovers(root: string, ...keep: string[]): string[] {
  return readdirSync(root).filter((name) => !keep.includes(name));
}

test('a fresh claim writes this process as the owner and release removes the lock', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  const release = claimDataDir(dataDir);
  const owner = holder(lockPath);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, hostname());
  assert.equal(typeof owner.id, 'string');
  assert.deepEqual(leftovers(root), ['data.lock']);
  release();
  assert.equal(existsSync(lockPath), false);
  assert.deepEqual(leftovers(root), []);
});

test('a held lock is refused with a message naming the directory and the lock file', (t) => {
  const { dataDir, lockPath } = sandbox(t);
  const release = claimDataDir(dataDir);
  t.after(release);
  const held = readFileSync(lockPath, 'utf8');
  assert.throws(() => claimDataDir(dataDir), (error: Error) => {
    assert.match(error.message, /is in use by another e2e run/);
    assert.ok(error.message.includes(`TOKKL_E2E_DATA_DIR ${dataDir} `), error.message);
    assert.ok(error.message.includes(`(process ${process.pid} on ${hostname()})`), error.message);
    assert.ok(error.message.includes(`delete ${lockPath}.`), error.message);
    return true;
  });
  assert.equal(readFileSync(lockPath, 'utf8'), held, 'a refused claim must not touch the lock');
});

test('a lock whose process is gone on this host is taken over', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), host: hostname(), id: 'crashed-run' }));
  const release = claimDataDir(dataDir);
  assert.equal(holder(lockPath).pid, process.pid);
  assert.deepEqual(leftovers(root), ['data.lock'], 'recovery must leave no guard or draft files');
  release();
  assert.equal(existsSync(lockPath), false);
});

test('a lock from another host is never treated as stale, even with a dead pid', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  const otherHost = `${hostname()}-other`;
  const foreign = JSON.stringify({ pid: deadPid(), host: otherHost, id: 'remote-run' });
  writeFileSync(lockPath, foreign);
  assert.throws(() => claimDataDir(dataDir), (error: Error) => {
    assert.match(error.message, /is in use by another e2e run/);
    assert.ok(error.message.includes(`on ${otherHost})`), error.message);
    return true;
  });
  assert.equal(readFileSync(lockPath, 'utf8'), foreign);
  assert.deepEqual(leftovers(root), ['data.lock']);
});

test('release removes only this process\'s lock', (t) => {
  const { dataDir, lockPath } = sandbox(t);
  const release = claimDataDir(dataDir);
  // Another run took the directory over after this one's lock went (for example, deleted by hand).
  const newer = JSON.stringify({ pid: process.ppid, host: hostname(), id: 'newer-run' });
  writeFileSync(lockPath, newer);
  release();
  assert.equal(readFileSync(lockPath, 'utf8'), newer, 'release deleted a lock it does not own');
  rmSync(lockPath);
  release();
  assert.equal(existsSync(lockPath), false, 'a second release must not recreate anything');
});

test('an old-format {pid, host} lock is recognised as held while its process runs', (t) => {
  const { dataDir, lockPath } = sandbox(t);
  const old = JSON.stringify({ pid: process.ppid, host: hostname() });
  writeFileSync(lockPath, old);
  assert.throws(() => claimDataDir(dataDir), (error: Error) => {
    assert.ok(error.message.includes(`(process ${process.ppid} on ${hostname()})`), error.message);
    return true;
  });
  assert.equal(readFileSync(lockPath, 'utf8'), old);
});

test('an old-format {pid, host} lock whose process is gone is taken over', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), host: hostname() }));
  const release = claimDataDir(dataDir);
  assert.equal(holder(lockPath).pid, process.pid);
  assert.deepEqual(leftovers(root), ['data.lock']);
  release();
});

test('a recovery guard left by a dead recoverer is cleared along with the stale lock', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  const pid = deadPid();
  const stale = JSON.stringify({ pid, host: hostname(), id: 'crashed-run' });
  writeFileSync(lockPath, stale);
  writeFileSync(guardPath(lockPath, stale), JSON.stringify({ pid, host: hostname(), id: 'crashed-recoverer' }));
  const release = claimDataDir(dataDir);
  assert.equal(holder(lockPath).pid, process.pid);
  assert.deepEqual(leftovers(root), ['data.lock']);
  release();
});

test('a guard held by a live recoverer is left alone', (t) => {
  const { root, dataDir, lockPath } = sandbox(t);
  const stale = JSON.stringify({ pid: deadPid(), host: hostname(), id: 'crashed-run' });
  const guard = guardPath(lockPath, stale);
  const live = JSON.stringify({ pid: process.ppid, host: hostname(), id: 'busy-recoverer' });
  writeFileSync(lockPath, stale);
  writeFileSync(guard, live);
  // The live recoverer never finishes here, so the claim gives up instead of deleting its files.
  assert.throws(() => claimDataDir(dataDir), /kept changing/);
  assert.equal(readFileSync(lockPath, 'utf8'), stale);
  assert.equal(readFileSync(guard, 'utf8'), live);
  assert.deepEqual(leftovers(root).sort(), ['data.lock', guard.slice(root.length + 1)].sort());
});

// One claimant process: imports the lock module, says it is ready, waits for the start time on
// stdin, spins until then so every claimant starts at the same instant, claims, holds the lock long
// enough for the others to decide, and reports whether the lock is still its own.
const CLAIMANT = `
const [moduleUrl, dataDir] = process.argv.slice(1);
const { claimDataDir } = await import(moduleUrl);
const { readFileSync } = await import('node:fs');
process.stdout.write('ready\\n');
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.includes('\\n')) break; }
const startAt = Number(input.trim());
while (Date.now() < startAt) { /* barrier */ }
let result;
try {
  const release = claimDataDir(dataDir);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  let pid = null;
  try { pid = JSON.parse(readFileSync(dataDir + '.lock', 'utf8')).pid; } catch {}
  release();
  result = { result: 'owner', stillHolds: pid === process.pid };
} catch (error) {
  const message = String(error.message);
  result = { result: message.includes('is in use by another e2e run') ? 'refused' : 'error', message };
}
process.stdout.write(JSON.stringify(result) + '\\n');
process.exit(0);
`;

type Outcome = { result: 'owner' | 'refused' | 'error'; stillHolds?: boolean; message?: string };

async function race(dataDir: string, claimants: number): Promise<Outcome[]> {
  const moduleUrl = new URL('./data-dir-lock.ts', import.meta.url).href;
  const children = Array.from({ length: claimants }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', CLAIMANT, moduleUrl, dataDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk; });
    const ready = new Promise<void>((resolve, reject) => {
      const check = (): void => { if (out.startsWith('ready\n')) resolve(); };
      child.stdout.on('data', check);
      child.on('exit', () => reject(new Error(`claimant exited before it was ready: ${err || out}`)));
    });
    const done = new Promise<Outcome>((resolve) => {
      child.on('close', () => {
        const line = out.trim().split('\n').pop() ?? '';
        try {
          resolve(JSON.parse(line) as Outcome);
        } catch {
          resolve({ result: 'error', message: `${out}${err}` });
        }
      });
    });
    return { child, ready, done };
  });
  await Promise.all(children.map(({ ready }) => ready));
  const startAt = String(Date.now() + 50);
  for (const { child } of children) child.stdin.end(`${startAt}\n`);
  return Promise.all(children.map(({ done }) => done));
}

test('claimants racing for a stale lock end with exactly one owner', async (t) => {
  const claimants = 6;
  const repeats = 4;
  for (let repeat = 0; repeat < repeats; repeat++) {
    const { root, dataDir, lockPath } = sandbox(t);
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), host: hostname() }));
    const outcomes = await race(dataDir, claimants);
    const errors = outcomes.filter((outcome) => outcome.result === 'error');
    assert.deepEqual(errors, [], `repeat ${repeat}: claimant errors`);
    const owners = outcomes.filter((outcome) => outcome.result === 'owner');
    assert.equal(owners.length, 1, `repeat ${repeat}: ${owners.length} owners`);
    assert.equal(owners[0]?.stillHolds, true, `repeat ${repeat}: the owner's lock was replaced while it held it`);
    assert.equal(outcomes.filter((outcome) => outcome.result === 'refused').length, claimants - 1);
    assert.deepEqual(leftovers(root), [], `repeat ${repeat}: files left behind`);
    assert.equal(existsSync(lockPath), false);
  }
});
