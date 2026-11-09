import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { keys, stale } from './keys.ts';
import { ApiError, UnparsableReplyError, api } from './client.ts';
import {
  acceptTimerState,
  attemptTimerRequest,
  pauseTimer,
  startPomodoro,
  startTimer,
  stopTimer,
  timerWrite,
} from './timerHooks.ts';
import { TIMER_OFFLINE_MESSAGE, TimerActionError, UnreadableTimerStateError } from './timerState.ts';
import type { TimeEntry, TimerState } from '@tokkl/types';
import { timeEntry, timerState } from '../testFixtures.ts';

const state = (revision: number, running_entry: TimeEntry | null = null) => timerState(revision, { running_entry });

const running = (id: number) =>
  timeEntry({ id, start: '2026-10-27T09:00:00.000Z', at: '2026-10-27T09:00:00.000Z', description: `Entry ${id}` });

const derived: QueryKey[] = [keys.entries, keys.report, keys.trash, keys.projects, keys.tasks, keys.tags];
const projectTasks: QueryKey = [...keys.tasks, 'project', 4];

/** A client holding data under every key, so each one can be checked for invalidation. */
function seeded(): QueryClient {
  const qc = new QueryClient();
  for (const key of [...derived, projectTasks, keys.clients]) qc.setQueryData(key, []);
  qc.setQueryData(keys.timer, state(1));
  return qc;
}

const invalidated = (qc: QueryClient, key: QueryKey) => qc.getQueryState(key)?.isInvalidated ?? false;

test('entry writes and timer changes share one policy that covers project and task totals', () => {
  const writes = new Set<QueryKey>(stale.entries);
  const changes = new Set<QueryKey>(stale.timerChanged);
  for (const key of derived) {
    assert.ok(writes.has(key), `entry writes refresh ${String(key)}`);
    assert.ok(changes.has(key), `timer changes refresh ${String(key)}`);
  }
  // A timer state carries the running entry, so only an entry write refetches it.
  assert.ok(writes.has(keys.timer));
  assert.ok(!changes.has(keys.timer));
});

test('a state that moved on marks everything derived from entries stale, totals included', () => {
  const qc = seeded();
  acceptTimerState(qc, state(2));
  for (const key of derived) assert.equal(invalidated(qc, key), true, String(key));
  assert.equal(invalidated(qc, projectTasks), true);
  assert.equal(invalidated(qc, keys.clients), false);
  assert.equal(invalidated(qc, keys.timer), false);
});

test('a state at the cached revision or older marks nothing stale', () => {
  const qc = seeded();
  acceptTimerState(qc, state(1));
  acceptTimerState(qc, state(0));
  for (const key of derived) assert.equal(invalidated(qc, key), false, String(key));
});

test('the running entry lives only in the timer state, so an older reply cannot bring back a replaced entry', () => {
  const qc = seeded();
  acceptTimerState(qc, state(3, running(9)));
  acceptTimerState(qc, state(2, running(8)));
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry?.id, 9);
  acceptTimerState(qc, state(4));
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry, null);
  assert.deepEqual(
    qc
      .getQueryCache()
      .findAll()
      .map(query => query.queryKey[0])
      .filter(key => key === 'current'),
    [],
    'no second cache holds a running entry',
  );
});

/**
 * A fetch that records each request and answers it with the next of `replies`: `body` as JSON,
 * `raw` as it is, or `fail` thrown as fetch throws.
 */
function answering(...replies: Array<{ status: number; body?: unknown; raw?: string } | { fail: Error }>) {
  const sent: Array<{ path: string; method: string; body: unknown }> = [];
  const keys: Array<string | undefined> = [];
  const fetch = (path: string, init: RequestInit) => {
    sent.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    keys.push((init.headers as Record<string, string> | undefined)?.['Idempotency-Key']);
    const reply = replies.shift();
    if (!reply) throw new Error(`No reply for ${path}`);
    if ('fail' in reply) return Promise.reject(reply.fail);
    return Promise.resolve(new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch, sent, keys };
}

test('Start posts the new entry at the cached revision and takes the reply as the timer state', async t => {
  const qc = seeded();
  const { fetch, sent } = answering({ status: 200, body: state(2, running(5)) });
  t.mock.method(globalThis, 'fetch', fetch);
  const reply = await startTimer(qc, { description: 'Write', tags: ['a'], start: '2026-10-27T10:00:00.000Z' });
  assert.deepEqual(sent, [
    {
      path: '/api/app/timer/start',
      method: 'POST',
      body: {
        created_with: 'tokkl-web',
        description: 'Write',
        tags: ['a'],
        start: '2026-10-27T10:00:00.000Z',
        revision: 1,
      },
    },
  ]);
  assert.equal(reply.running_entry?.id, 5);
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 2);
  assert.equal(invalidated(qc, keys.entries), true, 'the lists refetch for the started entry');
});

const actions: Array<[string, (qc: QueryClient) => Promise<unknown>, string, Record<string, unknown>]> = [
  [
    'Stop',
    qc => stopTimer(qc, '2026-10-27T10:30:00.000Z'),
    '/api/app/timer/stop',
    { stop: '2026-10-27T10:30:00.000Z' },
  ],
  ['Pause', qc => pauseTimer(qc), '/api/app/timer/pause', {}],
  [
    'A Pomodoro start',
    qc => startPomodoro(qc, { description: 'Focus', work_minutes: 25 }),
    '/api/app/pomodoro',
    { created_with: 'tokkl-web', description: 'Focus', work_minutes: 25 },
  ],
];

for (const [name, act, path, body] of actions)
  test(`${name} posts at the cached revision; a 409 hands over the current state`, async t => {
    const qc = seeded();
    qc.setQueryData(keys.timer, state(3, running(5)));
    const { fetch, sent } = answering({ status: 409, body: state(4, running(6)) }, { status: 200, body: state(5) });
    t.mock.method(globalThis, 'fetch', fetch);
    await assert.rejects(act(qc), (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict');
    assert.deepEqual(sent[0], { path, method: 'POST', body: { ...body, revision: 3 } });
    // The conflict's state replaced the stale one, so the next action goes out at its revision.
    assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry?.id, 6);
    await act(qc);
    assert.deepEqual(sent[1]?.body, { ...body, revision: 4 });
    assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 5);
  });

test('a Start that got no reply fails with the offline message', async t => {
  const qc = seeded();
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(
    startTimer(qc, { description: 'Lost' }),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'offline',
  );
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 1, 'the cached state stays');
});

const isApiErrorWith = (error: unknown, status: number) => error instanceof ApiError && error.status === status;

test('a Start answered twice with a 5xx keeps its message, and the next timer write reads the state first', async t => {
  const qc = seeded();
  const {
    fetch,
    sent,
    keys: sentKeys,
  } = answering(
    { status: 502, body: 'Bad Gateway' },
    { status: 502, body: 'Bad Gateway' },
    // The lost Start landed: the state moved on to a running entry.
    { status: 200, body: state(2, running(5)) },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(startTimer(qc, { description: 'Write' }), (error: unknown) => isApiErrorWith(error, 502));
  // A duration typed into the bar, which the bar still showed idle, is not sent on top of the landed Start.
  await assert.rejects(
    attemptTimerRequest(qc, () => api.post('/api/v9/workspaces/1/time_entries', { description: 'Typed' })),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict',
  );
  assert.deepEqual(
    sent.map(request => `${request.method} ${request.path}`),
    ['POST /api/app/timer/start', 'POST /api/app/timer/start', 'GET /api/app/timer'],
  );
  assert.deepEqual(sent[1]?.body, sent[0]?.body, 'the retry repeats the request');
  assert.ok(sentKeys[0], 'the Start carries a key');
  assert.equal(sentKeys[1], sentKeys[0], 'the retry reuses the key');
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry?.id, 5, 'the read state is adopted');
});

test('after an unknown outcome a read that finds the state unchanged lets the write go out, and reads once', async t => {
  const qc = seeded();
  qc.setQueryData(keys.timer, state(3, running(5)));
  const { fetch, sent } = answering(
    { status: 200, raw: '<html>proxy page</html>' },
    { status: 200, body: state(3, running(5)) },
    { status: 200, body: { ...running(5), description: 'Second' } },
    { status: 200, body: { ...running(5), description: 'Third' } },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  const edit = (description: string) =>
    timerWrite(qc, () => api.put('/api/v9/workspaces/1/time_entries/5', { description }));
  await assert.rejects(edit('First'), (error: unknown) => error instanceof UnparsableReplyError);
  await edit('Second');
  await edit('Third');
  assert.deepEqual(
    sent.map(request => `${request.method} ${request.path}`),
    [
      'PUT /api/v9/workspaces/1/time_entries/5',
      'GET /api/app/timer',
      'PUT /api/v9/workspaces/1/time_entries/5',
      'PUT /api/v9/workspaces/1/time_entries/5',
    ],
  );
});

test('an action reply that is not a whole state leaves the outcome unknown; a refusal does not', async t => {
  const qc = seeded();
  qc.setQueryData(keys.timer, state(3, running(5)));
  const { fetch, sent } = answering(
    { status: 400, body: 'Invalid stop' },
    { status: 200, body: { revision: 4 } },
    { status: 200, body: state(4) },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(stopTimer(qc), (error: unknown) => isApiErrorWith(error, 400));
  await assert.rejects(stopTimer(qc), (error: unknown) => error instanceof UnreadableTimerStateError);
  // The Stop landed: the read finds the timer stopped, so the next Start fails without being sent.
  await assert.rejects(
    startTimer(qc, { description: 'Next' }),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict',
  );
  assert.deepEqual(
    sent.map(request => `${request.method} ${request.path}`),
    ['POST /api/app/timer/stop', 'POST /api/app/timer/stop', 'GET /api/app/timer'],
  );
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry, null);
});

test('a reconciling read that fails sends nothing and keeps the outcome unknown', async t => {
  const qc = seeded();
  const { fetch, sent } = answering(
    { status: 500, body: 'boom' },
    { status: 500, body: 'boom' },
    { fail: new TypeError('Failed to fetch') },
    { status: 200, body: state(1) },
    { status: 200, body: state(2, running(6)) },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(startTimer(qc, { description: 'A' }), (error: unknown) => isApiErrorWith(error, 500));
  await assert.rejects(
    startTimer(qc, { description: 'B' }),
    (error: unknown) => error instanceof TimerActionError && error.message === TIMER_OFFLINE_MESSAGE,
  );
  await startTimer(qc, { description: 'C' });
  assert.deepEqual(
    sent.map(request => `${request.method} ${request.path}`),
    [
      'POST /api/app/timer/start',
      'POST /api/app/timer/start',
      'GET /api/app/timer',
      'GET /api/app/timer',
      'POST /api/app/timer/start',
    ],
  );
  assert.deepEqual(sent[4]?.body, { created_with: 'tokkl-web', description: 'C', revision: 1 });
});

test('a typed entry that got no reply fails with the offline message; other failures pass through', async () => {
  const qc = seeded();
  await assert.rejects(
    attemptTimerRequest(qc, () => Promise.reject(new TypeError('Failed to fetch'))),
    error => error instanceof TimerActionError && error.kind === 'offline' && error.message === TIMER_OFFLINE_MESSAGE,
  );
  const qc2 = seeded();
  const refused = new ApiError(400, 'Bad request');
  await assert.rejects(
    attemptTimerRequest(qc2, () => Promise.reject(refused)),
    error => error === refused,
  );
  assert.equal(await attemptTimerRequest(qc2, () => Promise.resolve(5)), 5);
});
