import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import type { TimerBus, TimerSignal } from '../../src/storage/timerBus.ts';
import { parseStorageConfig } from '../../src/storage/config.ts';
import { postgresOptions } from '../../src/storage/connections.ts';
import { startTimerBus, TIMER_BUS_APPLICATION, TIMER_BUS_CHANNEL } from '../../src/storage/timerBus.ts';
import { createLogger } from '../../src/lib/logger.ts';

// A real logger, as the server uses: the tests read what it prints and check it leaks no credentials.
const logger = createLogger();
import { disposableBackend } from './support/disposableBackend.ts';
import { until } from '../helpers.ts';

function captureConsole(t: TestContext): () => string {
  const lines: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => {
      lines.push(args.map(arg => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(' '));
    });
  }
  return () => lines.join('\n');
}

test('a server bus that cannot reach its database rejects within the connect timeout and holds no socket', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-bus-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Accepts TCP and never answers, so only the connect timeout ends the attempt.
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    socket.resume();
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const config = parseStorageConfig(
    {
      TOKKL_DATABASE_URL: `postgres://bus-user:bus-secret@127.0.0.1:${port}/bus_db?sslmode=disable&connect_timeout_ms=300`,
    },
    dir,
  );
  const output = captureConsole(t);
  const started = performance.now();
  await assert.rejects(startTimerBus(config, logger), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(
      `${error.message} ${error.stack} ${JSON.stringify(error)}`,
      /bus-user|bus-secret|bus_db|127\.0\.0\.1/,
    );
    return true;
  });
  assert.ok(performance.now() - started < 2000, 'startup must give up near the connect timeout');
  await until(() => sockets.size === 0, 'the abandoned connection to close', 3000);
  assert.doesNotMatch(output(), /bus-user|bus-secret|bus_db|127\.0\.0\.1/);

  const local = await startTimerBus(parseStorageConfig({}, dir), logger);
  const received: TimerSignal[] = [];
  local.receive(signal => received.push(signal));
  local.send({ userId: 1, revision: 1 });
  await sleep(20);
  assert.deepEqual(received, [], 'the single-process bus sends nothing');
  await local.close();
});

/** Accepts a login and one LISTEN, then goes silent without closing, so a graceful end waits forever. */
async function silentPeer(t: TestContext) {
  const message = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5);
    head.write(type, 0, 'latin1');
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  };
  const ready = message('Z', Buffer.from('I'));
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    let started = false,
      listening = false;
    socket.on('data', chunk => {
      if (!started) {
        started = true;
        socket.write(Buffer.concat([message('R', Buffer.alloc(4)), ready]));
      } else if (!listening && chunk[0] === 'Q'.charCodeAt(0)) {
        listening = true;
        socket.write(Buffer.concat([message('C', Buffer.from('LISTEN\0')), ready]));
      }
    });
    socket.on('error', () => {});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return { port: (server.address() as { port: number }).port, connections: () => sockets.size };
}

test('closing a bus whose server stopped answering destroys the listener socket at the deadline', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-bus-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const peer = await silentPeer(t);
  const config = parseStorageConfig(
    {
      TOKKL_DATABASE_URL: `postgres://bus-user:bus-secret@127.0.0.1:${peer.port}/bus_db?sslmode=disable&connect_timeout_ms=300`,
    },
    dir,
  );
  const ends = t.mock.method(pg.Client.prototype, 'end');
  const bus = await startTimerBus(config, logger);
  assert.equal(peer.connections(), 1);
  const started = performance.now();
  await bus.close();
  assert.ok(performance.now() - started < 1500, 'close gives up near the deadline');
  assert.equal(ends.mock.callCount(), 1);
  const client = ends.mock.calls[0]!.this as pg.Client;
  assert.ok(client.connection.stream.destroyed, 'nothing is left to keep the process alive');
});

test(
  'postgres: two buses share signals, reject forged payloads, survive a dropped listener and close cleanly',
  { timeout: 180000 },
  async t => {
    const fixture = await disposableBackend('postgres');
    const buses: TimerBus[] = [];
    const config = fixture.config;
    assert.ok(config.backend === 'postgres');
    const admin = new pg.Client({ ...postgresOptions(config, false), application_name: 'tokkl-test-admin' });
    admin.on('error', () => {});
    t.after(async () => {
      await Promise.allSettled([admin.end(), ...buses.map(bus => bus.close())]);
      await fixture.cleanup();
    });
    await admin.connect();
    const listeners = async () =>
      (
        await admin.query<{ pid: number }>(
          'SELECT pid FROM pg_stat_activity WHERE application_name = $1 ORDER BY pid',
          [TIMER_BUS_APPLICATION],
        )
      ).rows.map(row => row.pid);
    const notify = (payload: string) => admin.query('SELECT pg_notify($1, $2)', [TIMER_BUS_CHANNEL, payload]);

    const output = captureConsole(t);
    const a = await startTimerBus(config, logger);
    buses.push(a);
    const [aPid] = await listeners();
    assert.ok(aPid);
    const b = await startTimerBus(config, logger);
    buses.push(b);
    const bPid = (await listeners()).find(pid => pid !== aPid);
    assert.ok(bPid, 'each bus holds its own listener connection');
    const atA: TimerSignal[] = [],
      atB: TimerSignal[] = [];
    a.receive(signal => atA.push(signal));
    b.receive(signal => atB.push(signal));

    a.send({ userId: 3, revision: 41 });
    await until(() => atA.length === 1 && atB.length === 1, 'delivery to both buses');
    assert.deepEqual(atA, [{ userId: 3, revision: 41 }], 'the sender hears its own signal');
    assert.deepEqual(atB, [{ userId: 3, revision: 41 }]);

    const forged = [
      'not json',
      'null',
      '[3,41]',
      '"text"',
      '{}',
      '{"userId":3}',
      '{"revision":41}',
      '{"userId":3,"revision":41,"extra":true}',
      '{"__proto__":3,"revision":41}',
      '{"userId":0,"revision":41}',
      '{"userId":-3,"revision":41}',
      '{"userId":3,"revision":-1}',
      '{"userId":"3","revision":41}',
      '{"userId":3,"revision":"41"}',
      '{"userId":3.5,"revision":41}',
      '{"userId":3,"revision":null}',
      '{"userId":9007199254740993,"revision":41}',
      '{"userId":3,"revision":1e400}',
    ];
    for (const payload of forged) await notify(payload);
    // Notifications from one session arrive in order, so this marker proves the forged ones were processed.
    await notify('{"userId":5,"revision":0}');
    await until(() => atA.length === 2 && atB.length === 2, 'the marker signal');
    assert.deepEqual(atA, [
      { userId: 3, revision: 41 },
      { userId: 5, revision: 0 },
    ]);
    assert.deepEqual(atB, atA);

    await admin.query('SELECT pg_terminate_backend($1)', [bPid]);
    assert.doesNotThrow(() => b.send({ userId: 6, revision: 1 }));
    await until(async () => (await listeners()).some(pid => pid !== aPid && pid !== bPid), 'the listener to reconnect');
    assert.doesNotThrow(() => b.send({ userId: 6, revision: 2 }));
    await until(() => /Timer bus reconnected/.test(output()), 'the reconnect log line');
    const before = atB.length;
    a.send({ userId: 7, revision: 9 });
    await until(() => atB.some(signal => signal.userId === 7), 'delivery after reconnect');
    assert.deepEqual(
      atB.slice(before).filter(signal => signal.userId === 7),
      [{ userId: 7, revision: 9 }],
    );
    assert.match(output(), /Timer bus disconnected/);

    await Promise.all([b.close(), b.close()]);
    await b.close();
    const seenByB = atB.length;
    assert.doesNotThrow(() => b.send({ userId: 8, revision: 1 }));
    a.send({ userId: 8, revision: 2 });
    await until(() => atA.some(signal => signal.userId === 8), 'delivery to the open bus');
    assert.deepEqual(
      atA.filter(signal => signal.userId === 8),
      [{ userId: 8, revision: 2 }],
      'a closed bus sends nothing',
    );
    assert.equal(atB.length, seenByB, 'a closed bus hears nothing');
    await a.close();
    await a.close();
    await until(async () => (await listeners()).length === 0, 'listener connections to leave pg_stat_activity');

    const logs = output();
    assert.doesNotMatch(logs, new RegExp(config.password));
    assert.doesNotMatch(logs, /127\.0\.0\.1|localhost/);
    assert.doesNotMatch(logs, /userId|revision|not json|9007199254740993/);
  },
);
