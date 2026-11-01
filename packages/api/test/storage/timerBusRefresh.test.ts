import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'kysely';
import type { TimerState } from '@tokkl/types';
import type { Storage } from '../../src/storage/contracts.ts';
import type { User } from '../../src/storage/domain.ts';
import { createStorage } from '../../src/storage/index.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import type { TimerBus, TimerSignal } from '../../src/domain/timerBus.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate, readTimerStream, serveInvariant } from './support/invariantHttp.ts';

/** Links every bus it hands out. A send reaches every receiver, the sender's included, on a later
 * turn of the event loop, the way a database notification would. */
function signalHub() {
  const receivers: Array<(signal: TimerSignal) => void> = [], pending = new Set<Promise<void>>();
  const deliver = (signal: TimerSignal) => {
    const delivery = new Promise<void>(resolve => setImmediate(() => { for (const receive of receivers) receive({ ...signal }); resolve(); }));
    pending.add(delivery); void delivery.then(() => pending.delete(delivery));
    return delivery;
  };
  return {
    bus() {
      const sent: TimerSignal[] = [];
      let failing = false;
      const bus: TimerBus = {
        send(signal) { if (failing) throw new Error('bus unavailable'); sent.push({ ...signal }); void deliver(signal); },
        receive(handler) { receivers.push(handler); },
        async close() {},
      };
      return { bus, sent, fail(on: boolean) { failing = on; } };
    },
    inject: deliver,
    async settled() { while (pending.size) await Promise.all([...pending]); },
  };
}
/** Counts snapshot reads and can hold the next one, before it reads or after it has read. */
function readGate(storage: Storage) {
  let reads = 0, next: { when: 'before' | 'after'; entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | undefined;
  return {
    storage: { ...storage, async readSnapshot(work) {
      reads++;
      const held = next; next = undefined;
      if (held?.when === 'before') { held.entered.resolve(); await held.release.promise; }
      const result = await storage.readSnapshot(work);
      if (held?.when === 'after') { held.entered.resolve(); await held.release.promise; }
      return result;
    } } satisfies Storage,
    reads: () => reads,
    hold(when: 'before' | 'after') { const held = { when, entered: gate(), release: gate() }; next = held; return held; },
    release() { next?.release.resolve(); next = undefined; },
  };
}
const withoutTime = ({ server_time: _time, ...state }: TimerState) => state;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: timer signals rebuild remote streams in order without echoes`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 2 };
    const c = await initializeDatabase(config), other = await openConnection<PhysicalDatabase>(config);
    const stores = [createStorage(c), createStorage(other)];
    const hub = signalHub(), buses = [hub.bus(), hub.bus()], remote = readGate(stores[1]!);
    // No keep-alive tick during the test, so every read on B comes from the step that caused it.
    const options = (storage: Storage, timerBus: TimerBus) => ({ storage, timerBus, config: { ...testConfig(), storage: config },
      setup: { code: null }, timerStreamOptions: { keepAliveMs: 600000 } });
    const apps = [createApp(options(stores[0]!, buses[0]!.bus)), createApp(options(remote.storage, buses[1]!.bus))];
    const servers = await Promise.all(apps.map(serveInvariant));
    const streams: Array<Awaited<ReturnType<typeof readTimerStream>>> = [];
    t.after(async () => {
      remote.release();
      await Promise.all(streams.map(s => s.close()));
      await Promise.all(servers.map(s => s.close()));
      await Promise.all(stores.map(s => s.close()));
      await fixture.cleanup();
    });
    const account = (name: string, role: 'admin' | 'user' = 'user') => stores[0]!.users.createAccount({ email: `${name}@example.test`, fullName: name,
      passwordHash: 'unused', apiToken: randomBytes(16).toString('hex'), timezone: 'UTC', role, preferences: {} });
    const admin = await account('admin', 'admin'), u = await account('u'), v = await account('v'), w = await account('w');
    const send = (app: number, user: User, method: string, path: string, body?: unknown) => servers[app]!.request(method, path, body, user.apiToken);
    async function ok<T>(response: Response): Promise<T> {
      const body = await response.json() as T;
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    }
    async function stream(app: number, user: User) {
      const opened = await readTimerStream(await send(app, user, 'GET', '/api/app/timer/events'));
      streams.push(opened);
      await opened.until(() => opened.states.length > 0);
      return opened;
    }
    const revision = async (user: User) => (await stores[0]!.timers.getRevision(user.id))?.revision ?? 0;
    const entries = (user: User) => `/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`;
    const services = (app: number) => apps[app]!.locals.services;

    const onB = await stream(1, u);
    await t.test('a timer start, an entry write and a stop through A reach B\'s stream with the same revision', async () => {
      const started = await ok<TimerState>(await send(0, u, 'POST', '/api/app/pomodoro', {}));
      await onB.until(() => onB.states.some(s => s.revision === started.revision));
      const running = started.running_entry!.id;
      await ok(await send(0, u, 'PUT', `${entries(u)}/${running}`, { description: 'renamed on A' }));
      const renamed = await revision(u);
      assert.ok(renamed > started.revision);
      await onB.until(() => onB.states.some(s => s.revision === renamed));
      assert.equal(onB.states.at(-1)!.running_entry!.description, 'renamed on A');
      const ended = await ok<TimerState>(await send(0, u, 'POST', '/api/app/pomodoro/end', { revision: renamed }));
      await onB.until(() => onB.states.some(s => s.revision === ended.revision));
      assert.deepEqual(onB.states.map(s => s.revision), [0, started.revision, renamed, ended.revision]);
      assert.deepEqual(withoutTime(onB.states[1]!), withoutTime(started));
      assert.deepEqual(withoutTime(onB.states[3]!), withoutTime(ended));
      assert.equal(await revision(u), ended.revision, 'a remote rebuild never settles or commits');
      assert.deepEqual(buses[0]!.sent.map(s => s.userId), [u.id, u.id, u.id]);
      assert.deepEqual(buses[0]!.sent.map(s => s.revision), [started.revision, renamed, ended.revision]);
      assert.deepEqual(buses[1]!.sent, [], 'B sends nothing when it delivers a remote refresh');
    });

    await t.test('duplicate, self-echo, older and overtaken signals add no event and no revision', async () => {
      const onA = await stream(0, u), current = await revision(u), seenOnB = onB.states.length, seenOnA = onA.states.length;
      const reads = remote.reads();
      await Promise.all([hub.inject({ userId: u.id, revision: current }), hub.inject({ userId: u.id, revision: current }),
        hub.inject({ userId: u.id, revision: current - 1 }), hub.inject({ userId: u.id, revision: 0 })]);
      await hub.settled();
      assert.equal(remote.reads(), reads, 'signals at or below the delivered revision read nothing');
      // A hint above the database's revision rebuilds once and delivers nothing.
      await services(1).publish.refresh(u.id, current + 5);
      await pause(50);
      assert.equal(onB.states.length, seenOnB); assert.equal(onA.states.length, seenOnA);
      assert.equal(await revision(u), current);

      // B's rebuild for the first write waits while a second write commits. It reads the second
      // revision, so B skips the first, and the second signal finds nothing newer to fetch.
      const held = remote.hold('before');
      const first = await ok<{ id: number }>(await send(0, u, 'POST', entries(u), { start: new Date().toISOString(), description: 'first' }));
      await held.entered.promise;
      await ok(await send(0, u, 'PUT', `${entries(u)}/${first.id}`, { description: 'second' }));
      const second = await revision(u);
      assert.equal(second, current + 2);
      await hub.settled();
      held.release.resolve();
      await onB.until(() => onB.states.some(s => s.revision === second));
      await hub.settled(); await services(1).publish.refresh(u.id, second + 1); await pause(50);
      assert.deepEqual(onB.states.slice(seenOnB).map(s => s.revision), [second]);
      assert.equal(onB.states.at(-1)!.running_entry!.description, 'second');
      await onA.until(() => onA.states.some(s => s.revision === second));
      assert.deepEqual(onA.states.slice(seenOnA).map(s => s.revision), [current + 1, second], 'self-echo adds nothing on A');
      assert.equal(await revision(u), second);
      assert.deepEqual(buses[1]!.sent, []);
    });

    await t.test('signals never read for a user without a stream on B or reach another user\'s stream', async () => {
      const reads = remote.reads();
      await ok(await send(0, v, 'POST', entries(v), { start: new Date().toISOString(), description: 'v only on A' }));
      await hub.inject({ userId: v.id, revision: Number.MAX_SAFE_INTEGER });
      await hub.settled();
      assert.equal(remote.reads(), reads, 'no stream on B, no read on B');

      const vOnB = await stream(1, v), seenByV = vOnB.states.length;
      const before = await revision(u);
      const running = (await stores[0]!.entries.running(u.id))!;
      await ok(await send(0, u, 'PUT', `${entries(u)}/${running.id}`, { description: 'u again' }));
      await onB.until(() => onB.states.some(s => s.revision === before + 1));
      await hub.settled(); await pause(50);
      assert.equal(vOnB.states.length, seenByV);
      for (const state of vOnB.states) assert.equal(state.running_entry?.workspace_id, v.defaultWorkspaceId);
      assert.deepEqual(buses[1]!.sent, []);
    });

    await t.test('deleting the account on B while its rebuild is held delivers and sends nothing', async () => {
      const wOnB = await stream(1, w), seen = wOnB.states.length;
      const held = remote.hold('after');
      await ok(await send(0, w, 'POST', entries(w), { start: new Date().toISOString(), description: 'w on A' }));
      const committed = await revision(w);
      await held.entered.promise;
      await ok(await send(1, admin, 'DELETE', `/api/app/admin/users/${w.id}`, { email: w.email }));
      held.release.resolve();
      await wOnB.until(() => wOnB.ended());
      await hub.settled(); await pause(50);
      assert.equal(wOnB.states.length, seen);
      assert.ok(wOnB.states.every(s => s.revision < committed));
      assert.deepEqual(buses[1]!.sent, []);
    });

    await t.test('a failing bus send leaves the write and local delivery intact', async t => {
      const logged = t.mock.method(console, 'error', () => {});
      const onA = await stream(0, u), before = await revision(u), sent = buses[0]!.sent.length;
      buses[0]!.fail(true);
      try {
        await ok(await send(0, u, 'PATCH', `${entries(u)}/${(await stores[0]!.entries.running(u.id))!.id}/stop`));
      } finally { buses[0]!.fail(false); }
      assert.equal(await revision(u), before + 1);
      await onA.until(() => onA.states.some(s => s.revision === before + 1));
      assert.deepEqual(logged.mock.calls.map(call => call.arguments), [['Timer bus send failed']]);
      assert.equal(buses[0]!.sent.length, sent);
    });

    await t.test('state built for a deleted account never reaches the account that reuses its id', async () => {
      const doomed = await account('doomed'), onBDoomed = await stream(1, doomed);
      const started = await ok<{ id: number }>(await send(0, doomed, 'POST', entries(doomed), { start: new Date().toISOString(), description: 'doomed private 1' }));
      await ok(await send(0, doomed, 'PUT', `${entries(doomed)}/${started.id}`, { description: 'doomed private 2' }));
      const delivered = await revision(doomed);
      await onBDoomed.until(() => onBDoomed.states.some(s => s.revision === delivered));
      // B reads the next revision, then waits while the account is deleted and its id handed out again.
      const held = remote.hold('after');
      await ok(await send(0, doomed, 'PUT', `${entries(doomed)}/${started.id}`, { description: 'doomed private 3' }));
      await held.entered.promise;
      await ok(await send(0, admin, 'DELETE', `/api/app/admin/users/${doomed.id}`, { email: doomed.email }));
      // SQLite hands out the highest free id again. Servers keep a counter, so point it back.
      if (backend === 'postgres') await sql.raw(`ALTER TABLE users ALTER COLUMN id RESTART WITH ${doomed.id}`).execute(c.db);
      if (backend === 'mysql' || backend === 'mariadb') await sql.raw(`ALTER TABLE users AUTO_INCREMENT = ${doomed.id}`).execute(c.db);
      const replacement = await account('replacement');
      assert.equal(replacement.id, doomed.id);
      const onB = await stream(1, replacement);
      held.release.resolve();
      await hub.settled(); await pause(50);
      const leaked = (states: TimerState[]) => states.filter(s => s.running_entry?.description?.startsWith('doomed'));
      assert.deepEqual(onB.states.map(s => s.revision), [0], 'only the replacement\'s own initial state');
      assert.deepEqual(leaked(onB.states), []);

      await ok(await send(0, replacement, 'POST', entries(replacement), { start: new Date().toISOString(), description: 'replacement own' }));
      const own = await revision(replacement);
      assert.ok(own < delivered, 'the replacement\'s revisions start below what B delivered before');
      await onB.until(() => onB.states.some(s => s.revision === own));
      assert.equal(onB.states.at(-1)!.running_entry!.description, 'replacement own');
      assert.deepEqual(leaked(onB.states), []);
      assert.deepEqual(buses[1]!.sent, []);
    });
  });
}

test('a refresh that started before the account was forgotten delivers nothing', async () => {
  const built = gate(), release = gate(), delivered: number[] = [];
  const state = (revision: number): TimerState => ({ revision, server_time: '2026-10-30T12:00:00.000Z', running_entry: null, pause: null, pomodoro: null, discarded_pomodoro: null });
  let streams = true;
  const publish = createTimerPublication(async (_id, s) => { delivered.push(s.revision); }, () => { streams = false; },
    { hasStreams: () => streams, async rebuild() { built.resolve(); await release.promise; return { state: state(4), incarnation: 'only' }; } });
  const refreshing = publish.refresh(7, 4);
  await built.promise;
  publish.forgetUser(7);
  release.resolve();
  await refreshing;
  assert.deepEqual(delivered, []);
  // The next account behind the same id starts from nothing.
  streams = true;
  await publish.refresh(7, 4);
  assert.deepEqual(delivered, [4]);
});

test('a process drops deliveries for an incarnation of the id other than the one its streams opened for', async () => {
  const delivered: number[] = [], forgotten: number[] = [];
  const state = (revision: number): TimerState => ({ revision, server_time: '2026-10-30T12:00:00.000Z', running_entry: null, pause: null, pomodoro: null, discarded_pomodoro: null });
  let rebuilt = { state: state(9), incarnation: 'first' };
  const publish = createTimerPublication(async (_id, s) => { delivered.push(s.revision); }, id => { forgotten.push(id); },
    { hasStreams: () => true, async rebuild() { return rebuilt; } });
  publish.claim(7, 'first');
  await publish(7, state(5), 'first');
  // Another process deleted the account and a new one got the id. Its stream opens here.
  publish.claim(7, 'second');
  assert.deepEqual(forgotten, [7], 'the first account\'s streams and cached state go');
  await publish(7, state(6), 'first');
  await publish.refresh(7, 9);
  assert.deepEqual(delivered, [5], 'late work for the first account delivers nothing');
  rebuilt = { state: state(1), incarnation: 'second' };
  await publish.refresh(7, 1);
  await publish(7, state(2), 'second');
  assert.deepEqual(delivered, [5, 1, 2], 'the second account starts from nothing');
  publish.claim(7, 'second');
  assert.deepEqual(forgotten, [7], 'another stream for the same account forgets nothing');
});
