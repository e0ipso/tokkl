import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStorageConfig } from '../packages/api/src/storage/config.ts';
import { historyFailure, withHistoryCleanup } from './history-errors.ts';

let occupied = false;
let mode: 'ready' | 'exit' | 'spawn-error' | 'forced' | 'throw' = 'ready';
let provisions = 0;
let cleanups = 0;
let spawned: FakeChild;
let fixtureDirectory = '';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  pid = undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kills: string[] = [];
  finish(code: number | null, signal: string | null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
  kill(signal: string) {
    this.kills.push(signal);
    if (mode === 'forced' && signal === 'SIGTERM') return true;
    setImmediate(() => this.finish(signal === 'SIGKILL' ? null : 0, signal === 'SIGKILL' ? signal : null));
    return true;
  }
}

mock.module('node:net', { namedExports: { createServer() {
  const probe = new EventEmitter() as EventEmitter & { listen: Function; close: Function };
  probe.listen = (_port: number, _host: string, ready: () => void) => {
    if (occupied) probe.emit('error', new Error('occupied'));
    else ready();
  };
  probe.close = (closed: () => void) => closed();
  return probe;
} } });
mock.module('node:child_process', { namedExports: { spawn(_command: string, _args: string[], options: { stdio: string[] }) {
  assert.equal(options.stdio[2], 'ignore');
  if (mode === 'throw') throw new Error('spawn refused');
  spawned = new FakeChild();
  setImmediate(() => {
    if (mode === 'exit') spawned.finish(1, null);
    else if (mode === 'spawn-error') spawned.emit('error', new Error('private startup detail'));
    else spawned.stdout.emit('data', 'tokkl listening on test port');
  });
  return spawned;
} } });
mock.module('../packages/api/test/storage/support/disposableBackend.ts', { namedExports: { async disposableBackend(...args: unknown[]) {
  assert.equal(args.length, 1);
  provisions++;
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'history-lifecycle-test-'));
  return { config: parseStorageConfig({}, fixtureDirectory), async cleanup() { cleanups++; rmSync(fixtureDirectory, { recursive: true, force: true }); } };
} } });
const { Server } = await import('./history-server.ts');

test('occupied ports refuse before provisioning; readiness belongs to the spawned child; stop is exact and awaited', async t => {
  occupied = true;
  const before = provisions;
  await assert.rejects(Server.start('sqlite', 8290, 'setup'), /application port is unavailable/);
  assert.equal(provisions, before);
  occupied = false;
  mode = 'ready';
  let healthRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => { healthRequests++; return new Response('ok'); });
  const server = await Server.start('sqlite', 8290, 'setup');
  assert.equal(healthRequests, 1);
  const stopping = server.stop();
  assert.equal(server.stop(), stopping);
  await stopping;
  assert.deepEqual(spawned.kills, ['SIGTERM']);
  assert.equal(server.cleanupEvidence.exit, 0);
  assert.equal(server.cleanupEvidence.removed, true);
  assert.equal(existsSync(server.cleanupEvidence.directory), false);
  assert.equal(existsSync(fixtureDirectory), false);
  t.diagnostic(JSON.stringify({ api: server.cleanupEvidence, fixture_directory: fixtureDirectory, directories_absent: true, real_child_spawned: false }));
});

test('failed spawns and early exits retain primary startup failure and await disposable cleanup', async t => {
  let healthRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => { healthRequests++; return new Response('ok'); });
  for (const failing of ['spawn-error', 'exit', 'throw'] as const) {
    mode = failing;
    const before = cleanups;
    const error = await Server.start('sqlite', 8290, 'setup').catch(error => error);
    const failure = historyFailure(error);
    assert.match(failure.operation!.message, failing === 'spawn-error' ? /could not start/ : failing === 'exit' ? /exited before readiness/ : /spawn refused/);
    const api = failure.api_cleanup as { directory: string; removed?: boolean };
    assert.equal(existsSync(api.directory), false);
    assert.equal(existsSync(fixtureDirectory), false);
    assert.equal(cleanups, before + 1);
    assert.equal(JSON.stringify(failure).includes('private startup detail'), false);
    t.diagnostic(JSON.stringify({ mode: failing, failure, fixture_directory: fixtureDirectory, directories_absent: true, real_child_spawned: false }));
  }
  assert.equal(healthRequests, 0);
});

test('request failure and forced API shutdown both survive raw artifact serialization', async t => {
  mode = 'forced';
  t.mock.method(globalThis, 'fetch', async () => new Response('ok'));
  const timeout = globalThis.setTimeout;
  const deadlines: number[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    if (delay === 35000) deadlines.push(delay);
    return timeout(callback, delay === 35000 ? 1 : delay);
  });
  const server = await Server.start('sqlite', 8290, 'setup');
  const error = await withHistoryCleanup(async () => { throw new DOMException('Request deadline reached', 'TimeoutError'); }, () => server.stop()).catch(error => error);
  const raw = JSON.parse(JSON.stringify({ error: historyFailure(error), cleanup: server.cleanupEvidence }));
  assert.equal(raw.error.operation.name, 'TimeoutError');
  assert.equal(raw.error.cleanup.status, 'failed');
  assert.equal(raw.error.cleanup.error.message, 'Benchmark API did not shut down cleanly');
  assert.equal(raw.cleanup.exit, null);
  assert.equal(raw.cleanup.signal, 'SIGKILL');
  assert.equal(raw.cleanup.removed, true);
  assert.deepEqual(deadlines, [35000]);
  assert.deepEqual(spawned.kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(existsSync(server.cleanupEvidence.directory), false);
  assert.equal(existsSync(fixtureDirectory), false);
  t.diagnostic(JSON.stringify({ ...raw, fixture_directory: fixtureDirectory, directories_absent: true, real_child_spawned: false }));
});
