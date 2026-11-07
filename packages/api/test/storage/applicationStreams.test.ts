import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { TimerState } from '@tokkl/types';
import { errorHandler } from '../../src/http/errors.ts';
import { silentLogger } from '../../src/lib/logger.ts';
import { TimerStreams, type StreamCredentialResult } from '../../src/services/timerStreams.ts';
const state = (revision: number): TimerState => ({
  revision,
  server_time: '2026-10-30T12:00:00.000Z',
  running_entry: null,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
test(
  'initial builds serialize and an overtaken snapshot never follows a committed state',
  { timeout: 10000 },
  async t => {
    const entered = gate(),
      release = gate();
    let active = 0,
      max = 0,
      builds = 0;
    const streams = new TimerStreams(async () => {
      active++;
      max = Math.max(max, active);
      if (++builds === 1) {
        entered.resolve();
        await release.promise;
      }
      active--;
      return state(1);
    });
    const app = express();
    app.get('/', async (_req, res) => streams.open(1, res, async () => ({ valid: true, revision: 0 })));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    t.after(async () => {
      release.resolve();
      await streams.closeAll();
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    });
    const a = fetch(url);
    await entered.promise;
    const b = fetch(url);
    await new Promise(r => setTimeout(r, 40));
    await streams.publish(1, state(3));
    release.resolve();
    for (const request of [a, b]) {
      const response = await request;
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      assert.match(new TextDecoder().decode(chunk.value), /"revision":3/);
      await reader.cancel();
    }
    assert.equal(max, 1);
  },
);
test('an initial async failure reaches Express before headers are sent', { timeout: 10000 }, async t => {
  const streams = new TimerStreams(async () => {
    throw Error('read failed');
  });
  const app = express();
  app.get('/', async (_req, res) => streams.open(1, res, async () => ({ valid: true, revision: 0 })));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(500).json('safe error'),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => {
    await streams.closeAll();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  assert.equal(response.status, 500);
  assert.equal(await response.json(), 'safe error');
});
test(
  'a broken initial subscriber leaves no keep-alive and cannot suppress another subscriber',
  { timeout: 10000 },
  async t => {
    let intervals = 0;
    const original = setInterval;
    t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => {
      intervals++;
      return original(...args);
    });
    const streams = new TimerStreams(async () => state(0));
    const app = express();
    app.get('/broken', async (_req, res) => {
      res.write = () => {
        throw Error('broken subscriber');
      };
      await streams.open(1, res, async () => ({ valid: true, revision: 0 }));
    });
    app.get('/good', async (_req, res) => streams.open(1, res, async () => ({ valid: true, revision: 0 })));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t.after(async () => {
      await streams.closeAll();
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    });
    await (await fetch(base + '/broken')).text();
    assert.equal(intervals, 0);
    const good = await fetch(base + '/good');
    const reader = good.body!.getReader();
    await reader.read();
    await streams.publish(1, state(2));
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /"revision":2/);
    await reader.cancel();
  },
);
test('retiring an account detaches its pending initial build from a reused identity', { timeout: 10000 }, async t => {
  const entered = gate(),
    release = gate();
  let builds = 0;
  const streams = new TimerStreams(async () => {
    if (++builds === 1) {
      entered.resolve();
      await release.promise;
      return state(9);
    }
    return state(0);
  });
  const app = express();
  app.get('/', async (_req, res) => streams.open(1, res, async () => ({ valid: true, revision: 0 })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  t.after(async () => {
    release.resolve();
    await streams.closeAll();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  });
  const old = fetch(url);
  await entered.promise;
  streams.forgetUser(1);
  await (await old).text();
  const fresh = await fetch(url);
  const reader = fresh.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":0/);
  release.resolve();
  await streams.publish(1, state(1));
  assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":1/);
  await reader.cancel();
  assert.equal(builds, 2);
});
/** An app that opens a stream for the user id in the path, with the API's error replies. */
async function streamServer(
  t: TestContext,
  streams: TimerStreams,
  check: (id: number) => Promise<StreamCredentialResult>,
) {
  let arrived = 0;
  const app = express();
  app.get('/:id', async (req, res) => {
    arrived++;
    const id = Number(req.params.id);
    await streams.open(id, res, () => check(id));
  });
  app.use(errorHandler(silentLogger));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => {
    await streams.closeAll();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return { base, arrived: () => arrived };
}
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise(r => setTimeout(r, 5));
}
test('a burst over the per-user cap checks and builds only the streams it keeps', { timeout: 10000 }, async t => {
  const release = gate();
  t.after(() => release.resolve());
  let checks = 0,
    builds = 0;
  const streams = new TimerStreams(
    async () => {
      builds++;
      return state(1);
    },
    { maxPerUser: 2 },
  );
  const { base, arrived } = await streamServer(t, streams, async () => {
    if (++checks === 1) await release.promise;
    return { valid: true, revision: 0 };
  });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const requests: Array<Promise<Response>> = [];
  // One at a time, so the server sees them in order and the oldest are the first four.
  for (let n = 1; n <= 6; n++) {
    requests.push(fetch(base + '1', { signal: abort.signal }));
    await until(() => arrived() === n);
  }
  release.resolve();
  const responses = await Promise.all(requests);
  // The four oldest end as the oldest stream over the cap always has: an empty response.
  for (const response of responses.slice(0, 4)) assert.equal(await response.text(), '');
  for (const response of responses.slice(4)) {
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: timer/);
    await reader.cancel();
  }
  assert.equal(builds, 2);
  // The first check was already running. The kept two are checked before building and again before sending.
  assert.equal(checks, 1 + 2 * 2);
});
test('streams still opening count toward the process-wide cap', { timeout: 10000 }, async t => {
  const release = gate();
  t.after(() => release.resolve());
  const checked: number[] = [];
  const streams = new TimerStreams(async () => state(1), { maxStreams: 2 });
  const { base, arrived } = await streamServer(t, streams, async id => {
    checked.push(id);
    await release.promise;
    return { valid: true, revision: 0 };
  });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const opening = [fetch(base + '1', { signal: abort.signal }), fetch(base + '2', { signal: abort.signal })];
  await until(() => arrived() === 2);
  const refused = await fetch(base + '3', { signal: AbortSignal.timeout(3000) });
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('retry-after'), '5');
  assert.equal(await refused.json(), 'Too many timer streams, try again later');
  release.resolve();
  for (const response of await Promise.all(opening)) {
    assert.equal(response.status, 200);
    await response.body!.cancel();
  }
  assert.equal(checked.includes(3), false);
});
