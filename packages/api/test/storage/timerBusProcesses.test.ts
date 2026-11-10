import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import type { TimerState } from '@tokkl/types';
import { postgresOptions } from '../../src/storage/connections.ts';
import { TIMER_BUS_APPLICATION, TIMER_BUS_CHANNEL } from '../../src/storage/timerBus.ts';
import { databaseUrl, openTimerStream, startApi, type ApiProcess } from './support/apiProcess.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { until } from '../helpers.ts';

/** The keep-alive is 25 s, so a delivery under this came from the bus. */
const FAST_MS = 5000;
/** One keep-alive tick plus slack for the rebuild. */
const TICK_DEADLINE_MS = 60000;
const SETTLE_MS = 300;

type TimerStream = Awaited<ReturnType<typeof openTimerStream>>;
type Visible = Omit<TimerState, 'server_time'>;

const visible = ({ server_time: _time, ...rest }: TimerState): Visible => rest;
const basic = (token: string) => `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`;

test(
  'postgres: two API processes share timer changes, recover a missed signal, honor revocation and isolation, and shut down clean',
  { timeout: 240000 },
  async t => {
    const fixture = await disposableBackend('postgres');
    const config = fixture.config;
    assert.ok(config.backend === 'postgres');
    const dirs = [mkdtempSync(join(tmpdir(), 'tokkl-a-')), mkdtempSync(join(tmpdir(), 'tokkl-b-'))];
    const processes: ApiProcess[] = [];
    const streams: TimerStream[] = [];
    const options = { ...postgresOptions(config, false) };
    const admin = new pg.Client({ ...options, application_name: 'tokkl-test-admin' });
    const observer = new pg.Client({ ...options, application_name: 'tokkl-test-observer' });
    for (const client of [admin, observer]) client.on('error', () => {});
    t.after(async () => {
      for (const proc of processes) if (proc.child.exitCode === null) proc.child.kill('SIGTERM');
      await Promise.allSettled([...streams.map(stream => stream.close()), admin.end(), observer.end()]);
      await Promise.allSettled(
        processes.map(
          proc =>
            new Promise<void>(resolve =>
              proc.child.exitCode === null ? proc.child.once('exit', () => resolve()) : resolve(),
            ),
        ),
      );
      await fixture.cleanup();
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });
    await Promise.all([admin.connect(), observer.connect()]);

    const listeners = async () =>
      (
        await admin.query<{ pid: number }>(
          'SELECT pid FROM pg_stat_activity WHERE application_name = $1 ORDER BY pid',
          [TIMER_BUS_APPLICATION],
        )
      ).rows.map(row => row.pid);
    const payloads: string[] = [];
    observer.on('notification', message => {
      if (message.channel === TIMER_BUS_CHANNEL) payloads.push(message.payload!);
    });
    await observer.query(`LISTEN ${TIMER_BUS_CHANNEL}`);

    const open = async (proc: ApiProcess, token: string) => {
      const stream = await openTimerStream(proc.base, token);
      streams.push(stream);
      return stream;
    };
    const call = async <T = unknown>(
      proc: ApiProcess,
      token: string,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      const response = await fetch(proc.base + path, {
        method,
        headers: {
          authorization: basic(token),
          'x-tokkl-csrf': '1',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      assert.equal(response.status, 200, `${method} ${path}: ${text}`);
      return JSON.parse(text) as T;
    };

    const a = await startApi(databaseUrl(config), dirs[0]!);
    processes.push(a);
    assert.equal((await listeners()).length, 1, 'A listens on the bus by the time it reports listening');
    const setup = await fetch(`${a.base}/api/app/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1' },
      body: JSON.stringify({
        email: 'ada@example.test',
        password: 'correct horse battery',
        fullname: 'Ada',
        timezone: 'Europe/Madrid',
        setup_code: 'TEST-CODE',
      }),
    });
    assert.equal(setup.status, 200);
    const cookieMe = async (cookie: string) => {
      const response = await fetch(`${a.base}/api/v9/me`, { headers: { cookie } });
      assert.equal(response.status, 200);
      return (await response.json()) as { id: number; api_token: string; default_workspace_id: number };
    };
    const ada = await cookieMe(setup.headers.get('set-cookie')!.split(';')[0]!);
    let token = ada.api_token;
    const wid = ada.default_workspace_id;

    const invite = await call<{ url: string }>(a, token, 'POST', '/api/app/admin/invites', { role: 'user' });
    const accepted = await fetch(`${a.base}/api/app/invites/${invite.url.replace(/^\/invite\//, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tokkl-csrf': '1' },
      body: JSON.stringify({
        email: 'bob@example.test',
        password: 'invited person 1',
        fullname: 'Bob',
        timezone: 'Europe/Madrid',
      }),
    });
    assert.equal(accepted.status, 200);
    const bob = await cookieMe(accepted.headers.get('set-cookie')!.split(';')[0]!);

    const [aListener] = await listeners();
    const b = await startApi(databaseUrl(config), dirs[1]!);
    processes.push(b);
    const afterStart = await listeners();
    assert.equal(afterStart.length, 2, 'B listens on the bus by the time it reports listening');
    const bListener = afterStart.find(pid => pid !== aListener)!;
    assert.ok(bListener);

    // The first write goes out right after B reports listening, so a late LISTEN would lose it.
    const onB = await open(b, token);
    const onA = await open(a, token);
    const bobOnB = await open(b, bob.api_token);
    await Promise.all([onB, onA, bobOnB].map(stream => stream.until(() => stream.states.length === 1)));

    const latencies: Record<string, number> = {};
    const timerAt = (proc: ApiProcess, as = token) => call<TimerState>(proc, as, 'GET', '/api/app/timer');
    const entries = `/api/v9/workspaces/${wid}/time_entries`;

    async function delivered(label: string, write: () => Promise<unknown>): Promise<TimerState> {
      const seenB = onB.states.length,
        seenA = onA.states.length,
        sent = payloads.length;
      const started = Date.now();
      await write();
      const expected = await timerAt(a);
      await onB.until(() => onB.states.some(state => state.revision === expected.revision), FAST_MS);
      latencies[label] = Date.now() - started;
      assert.ok(latencies[label]! < FAST_MS, `${label} took ${latencies[label]} ms`);
      assert.deepEqual(
        visible(onB.states.find(state => state.revision === expected.revision)!),
        visible(expected),
        `${label}: B's state equals A's`,
      );
      await sleep(SETTLE_MS);
      assert.equal(
        (await timerAt(a)).revision,
        expected.revision,
        `${label}: A's revision is unchanged by the delivery`,
      );
      assert.equal(
        (await timerAt(b)).revision,
        expected.revision,
        `${label}: B's revision is unchanged by the delivery`,
      );
      assert.equal(onB.states.length, seenB + 1, `${label}: B streams one event`);
      assert.equal(onA.states.length, seenA + 1, `${label}: A streams one event, so its own signal is not echoed`);
      assert.deepEqual(
        payloads.slice(sent).map(payload => JSON.parse(payload)),
        [{ userId: ada.id, revision: expected.revision }],
        `${label}: only the writer notifies, and once`,
      );
      return expected;
    }

    await t.test('fast path: each timer change committed through A reaches B with the same revision', async () => {
      const started = await delivered('start', () =>
        call(a, token, 'POST', entries, {
          start: new Date().toISOString(),
          duration: -1,
          description: 'Writing',
          created_with: 'test',
        }),
      );
      assert.ok(started.running_entry);
      await delivered('entry write', () =>
        call(a, token, 'PUT', `${entries}/${started.running_entry!.id}`, { description: 'Editing' }),
      );
      const paused = await delivered('pause', () => call(a, token, 'POST', '/api/app/timer/pause', {}));
      assert.equal(paused.pause?.paused, true);
      const resumed = await delivered('resume', () =>
        call(a, token, 'POST', '/api/app/timer/resume', { revision: paused.revision }),
      );
      assert.ok(resumed.running_entry);
      await delivered('stop', () => call(a, token, 'PATCH', `${entries}/${resumed.running_entry!.id}/stop`));
      const session = await delivered('pomodoro start', () =>
        call(a, token, 'POST', '/api/app/pomodoro', { description: 'Deep work' }),
      );
      assert.equal(session.pomodoro?.phase.kind, 'work');
      const rest = await delivered('pomodoro next', () =>
        call(a, token, 'POST', '/api/app/pomodoro/next', { revision: session.revision }),
      );
      assert.equal(rest.pomodoro?.phase.kind, 'shortRest');
      await delivered('pomodoro end', () =>
        call(a, token, 'POST', '/api/app/pomodoro/end', { revision: rest.revision }),
      );
      console.log(`fast path latencies (ms): ${JSON.stringify(latencies)}`);
      const revisions = onB.states.map(state => state.revision);
      assert.ok(
        revisions.every((revision, i) => i === 0 || revision > revisions[i - 1]!),
        'B sees strictly increasing revisions',
      );
    });

    await t.test("isolation: another user's stream sees only its own changes", async () => {
      assert.equal(bobOnB.states.length, 1, "Ada's changes never reached Bob's stream on B");
      const seenByAda = onB.states.length;
      const entry = await call<{ id: number }>(
        a,
        bob.api_token,
        'POST',
        `/api/v9/workspaces/${bob.default_workspace_id}/time_entries`,
        { start: new Date().toISOString(), duration: -1, description: "Bob's work", created_with: 'test' },
      );
      await bobOnB.until(() => bobOnB.states.some(state => state.running_entry?.id === entry.id), FAST_MS);
      await sleep(SETTLE_MS);
      assert.equal(onB.states.length, seenByAda, "Bob's change never reached Ada's stream on B");
      assert.ok(bobOnB.states.every(state => state.running_entry === null || state.running_entry.id === entry.id));
      assert.equal(bobOnB.states.length, 2);
    });

    await t.test('forged, duplicate and older signals change nothing on B', async () => {
      const current = await timerAt(a);
      const seenB = onB.states.length;
      const seenBob = bobOnB.states.length;
      const sent = payloads.length;
      for (const payload of [
        'garbage',
        JSON.stringify({ userId: ada.id, revision: current.revision }),
        JSON.stringify({ userId: ada.id, revision: current.revision - 1 }),
        JSON.stringify({ userId: ada.id, revision: current.revision, extra: true }),
      ]) {
        await admin.query('SELECT pg_notify($1, $2)', [TIMER_BUS_CHANNEL, payload]);
      }
      await until(() => payloads.length === sent + 4, 'the observer to see every forged signal', 5000);
      await sleep(SETTLE_MS);
      assert.equal(onB.states.length, seenB);
      assert.equal(bobOnB.states.length, seenBob);
      assert.equal((await timerAt(a)).revision, current.revision);
      assert.equal((await timerAt(b)).revision, current.revision);
      assert.equal(payloads.length, sent + 4, 'B sends nothing back');
    });

    await t.test('missed signal: B recovers at the keep-alive tick, then fast delivery resumes', async () => {
      const seenDisconnects = (b.logs().match(/Timer bus disconnected/g) ?? []).length;
      const missedFrom = onB.states.length;
      assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS ended', [bListener])).rows[0].ended, true);
      const started = Date.now();
      const entry = await call<{ id: number }>(a, token, 'POST', entries, {
        start: new Date().toISOString(),
        duration: -1,
        description: 'Missed',
        created_with: 'test',
      });
      const expected = await timerAt(a);
      await onB.until(() => onB.states.some(state => state.revision === expected.revision), TICK_DEADLINE_MS);
      const waited = Date.now() - started;
      console.log(`missed signal reached B after ${waited} ms`);
      assert.equal(onB.states.length, missedFrom + 1);
      assert.deepEqual(visible(onB.states.at(-1)!), visible(expected));
      assert.equal(expected.running_entry?.id, entry.id);
      assert.ok(
        (b.logs().match(/Timer bus disconnected/g) ?? []).length > seenDisconnects,
        'B noticed its listener was gone',
      );

      await until(
        async () => {
          const now = await listeners();
          return now.length === 2 && !now.includes(bListener);
        },
        "B's listener to reappear",
        15000,
      );
      await until(() => /Timer bus reconnected/.test(b.logs()), 'B to log the reconnect', 5000);
      await delivered('after reconnect', () =>
        call(a, token, 'PUT', `${entries}/${entry.id}`, { description: 'Back on the bus' }),
      );
    });

    await t.test(
      'revocation: a stream on B whose token was rotated through A ends without the newer state',
      async () => {
        const stale = await open(b, token);
        await stale.until(() => stale.states.length === 1);
        const old = token;
        token = await call<string>(a, old, 'POST', '/api/v9/me/reset_token');
        assert.notEqual(token, old);
        const fresh = await open(b, token);
        await fresh.until(() => fresh.states.length === 1);
        const entry = await call<{ id: number }>(a, token, 'POST', `${entries}`, {
          start: new Date().toISOString(),
          duration: -1,
          description: 'After rotation',
          created_with: 'test',
        });
        await fresh.until(() => fresh.states.some(state => state.running_entry?.id === entry.id), FAST_MS);
        await stale.until(stale.ended, FAST_MS);
        assert.equal(stale.states.length, 1, 'the revoked stream received nothing newer than its first state');
        assert.ok(!stale.states.some(state => state.running_entry?.id === entry.id));
      },
    );

    await t.test('shutdown: SIGTERM stops both processes with exit code 0 and leaves no listener', async () => {
      await a.stop();
      await b.stop();
      await until(async () => (await listeners()).length === 0, 'listener sessions to leave pg_stat_activity', 10000);
      for (const proc of processes) {
        const logs = proc.logs();
        assert.ok(!logs.includes(config.password), 'logs never carry the database password');
        assert.doesNotMatch(logs, /pg_notify|"userId"|"revision"|garbage/);
        assert.doesNotMatch(logs, /Unhandled|failed/i);
        assert.ok(logs.indexOf('tokkl listening') >= 0);
      }
    });
  },
);
