import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { keys, stale } from './keys.ts';
import { acceptTimerState, startTimer, stopTimer } from './timerHooks.ts';
import { TimerActionError } from './timerState.ts';
import type { TimeEntry, TimerState } from './types.ts';

const state = (revision: number, running_entry: TimeEntry | null = null): TimerState => ({
  revision,
  server_time: '2026-10-27T10:00:00.000Z',
  running_entry,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});

const running = (id: number): TimeEntry => ({
  id,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T09:00:00.000Z',
  stop: null,
  duration: -1,
  description: `Entry ${id}`,
  tags: [],
  tag_ids: [],
  at: '2026-10-27T09:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
});

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

/** A fetch that records each request and answers it with the next of `replies`. */
function answering(...replies: Array<{ status: number; body: unknown }>) {
  const sent: Array<{ path: string; method: string; body: unknown }> = [];
  const fetch = (path: string, init: RequestInit) => {
    sent.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = replies.shift();
    if (!reply) throw new Error(`No reply for ${path}`);
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch, sent };
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

test('Stop posts the stop time at the cached revision; a 409 hands over the current state', async t => {
  const qc = seeded();
  qc.setQueryData(keys.timer, state(3, running(5)));
  const { fetch, sent } = answering({ status: 409, body: state(4, running(6)) }, { status: 200, body: state(5) });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(
    stopTimer(qc, '2026-10-27T10:30:00.000Z'),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict',
  );
  assert.deepEqual(sent[0], {
    path: '/api/app/timer/stop',
    method: 'POST',
    body: { revision: 3, stop: '2026-10-27T10:30:00.000Z' },
  });
  // The conflict's state replaced the stale one, so the next stop goes out at its revision.
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry?.id, 6);
  await stopTimer(qc);
  assert.deepEqual(sent[1]?.body, { revision: 4 });
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry, null);
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
