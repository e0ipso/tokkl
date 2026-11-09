import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { dropChange } from '../lib/calendarDrop.ts';
import { updateEntry, updateRunningEntry } from './entries.ts';
import { keys } from './keys.ts';
import {
  TIMER_CONFLICT_MESSAGE,
  TimerActionError,
  isTimerUnknown,
  markTimerUnknown,
  settleOtherWrites,
} from './timerState.ts';
import type { TimeEntry, TimerState } from './types.ts';

const entry = (id: number, description: string): TimeEntry => ({
  id,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T09:00:00.000Z',
  stop: null,
  duration: -1,
  description,
  tags: [],
  tag_ids: [],
  at: '2026-10-27T09:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
});

const state = (revision: number, running_entry: TimeEntry | null): TimerState => ({
  revision,
  server_time: '2026-10-27T10:00:00.000Z',
  running_entry,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});

const EDIT_PATH = '/api/app/timer/edit';

/**
 * A fetch that holds every request until the test answers it, in any order. A v9 update is
 * answered with the entry; a running-entry edit with a state running entry 7, at revisions 4, 5
 * and on.
 */
function holding() {
  const requests: Array<{ path: string; body: Record<string, unknown>; answer: () => void }> = [];
  let revision = 3;
  const fetch = (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const description = String(body.description);
    const reply =
      path === EDIT_PATH
        ? state((revision += 1), entry(7, description))
        : entry(Number(path.split(/[/?]/)[6]), description);
    return new Promise<Response>(resolve => {
      requests.push({ path, body, answer: () => resolve(new Response(JSON.stringify(reply))) });
    });
  };
  return { fetch, requests };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function withTimer(revision: number): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(keys.timer, state(revision, entry(7, 'Wr')));
  return qc;
}

test('edits of one entry go out one at a time, in the order made; edits of another entry do not wait', async t => {
  const qc = withTimer(3);
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateEntry(qc, 1, { id: 7, description: 'Wri' });
  const second = updateRunningEntry(qc, { id: 7, description: 'Write' });
  const other = updateEntry(qc, 1, { id: 8, description: 'Other' });
  await tick();
  assert.deepEqual(
    requests.map(request => request.body.description),
    ['Wri', 'Other'],
    'the second edit of entry 7 waits for the first',
  );
  requests[1]!.answer();
  await other;
  requests[0]!.answer();
  await first;
  await tick();
  assert.deepEqual(
    requests.map(request => request.body.description),
    ['Wri', 'Other', 'Write'],
  );
  assert.equal(requests[2]!.path, EDIT_PATH);
  requests[2]!.answer();
  assert.equal((await second).running_entry?.description, 'Write');
});

test('a running-entry edit goes through the timer naming its entry, with no revision', async t => {
  const qc = withTimer(3);
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateRunningEntry(qc, { id: 7, description: 'Write', tags: ['a'], project_id: null });
  const second = updateRunningEntry(qc, { id: 7, billable: true, description: 'Write' });
  await tick();
  assert.deepEqual(
    requests.map(request => [request.path, request.body]),
    [[EDIT_PATH, { description: 'Write', tags: ['a'], project_id: null, entry_id: 7 }]],
  );
  requests[0]!.answer();
  await first;
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 4, 'the reply is the new timer state');
  await tick();
  assert.deepEqual(requests[1]?.body, { billable: true, description: 'Write', entry_id: 7 });
  requests[1]!.answer();
  await second;
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 5);
});

/** A fetch that answers each request with the next of `replies` and records what was sent. */
function answering(...replies: Array<{ status: number; body: unknown }>) {
  const sent: Array<{ request: string; body?: Record<string, unknown> }> = [];
  const fetch = (path: string, init: RequestInit) => {
    const request = `${init.method ?? 'GET'} ${path}`;
    sent.push(init.body ? { request, body: JSON.parse(String(init.body)) as Record<string, unknown> } : { request });
    const reply = replies.shift();
    if (!reply) return Promise.reject(new Error('No reply left'));
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch, sent };
}

const isConflict = (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict';

test("the entry editor's save of the running entry sends its labels and moved start through the timer", async t => {
  const qc = withTimer(3);
  const moved = { ...entry(7, 'Write'), start: '2026-10-27T08:30:00.000Z' };
  const { fetch, sent } = answering({ status: 200, body: state(4, moved) });
  t.mock.method(globalThis, 'fetch', fetch);
  const reply = await updateRunningEntry(qc, { id: 7, description: 'Write', start: moved.start });
  assert.deepEqual(sent, [
    { request: `POST ${EDIT_PATH}`, body: { description: 'Write', start: moved.start, entry_id: 7 } },
  ]);
  assert.equal(reply.running_entry?.start, moved.start);
});

test('a running-entry edit refused because another entry runs fails with the conflict and is not sent again', async t => {
  const qc = withTimer(3);
  const current = state(6, entry(9, 'Started elsewhere'));
  const { fetch, sent } = answering({ status: 409, body: current });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Late' }), isConflict);
  assert.equal(sent.length, 1, 'the edit never goes to entry 9');
  assert.deepEqual(qc.getQueryData<TimerState>(keys.timer), current);
});

test('a running-entry edit refused because nothing runs fails with the conflict and is not sent again', async t => {
  const qc = withTimer(3);
  const { fetch, sent } = answering({ status: 409, body: state(6, null) });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Late' }), isConflict);
  assert.equal(sent.length, 1);
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry, null);
});

test('a calendar move of the running entry another device stopped takes the server state and changes nothing', async t => {
  const qc = withTimer(3);
  const current = state(6, null);
  const { fetch, sent } = answering({ status: 409, body: current });
  t.mock.method(globalThis, 'fetch', fetch);
  const drag = { entry: entry(7, 'Wr'), day: '2026-10-27', originY: 0, startMinute: 0, endMinute: 0 };
  const settings = { timeZone: 'Europe/Madrid', timeResolution: 1 };
  const change = dropChange({ kind: 'move', ...drag, deltaMinutes: -30 }, settings, false);
  assert.ok(change.kind === 'moveRunning');
  await assert.rejects(
    updateRunningEntry(qc, { id: change.id, start: change.start }),
    (error: unknown) => isConflict(error) && error instanceof Error && error.message === TIMER_CONFLICT_MESSAGE,
  );
  assert.deepEqual(
    sent,
    [{ request: `POST ${EDIT_PATH}`, body: { start: '2026-10-27T08:30:00.000Z', entry_id: 7 } }],
    'one timer edit and no v9 update',
  );
  assert.deepEqual(qc.getQueryData<TimerState>(keys.timer), current);
});

test('after an unknown outcome a running-entry edit reads the state, and goes out although the revision moved', async t => {
  const qc = withTimer(3);
  markTimerUnknown(qc);
  const { fetch, sent } = answering(
    { status: 200, body: state(5, { ...entry(7, 'Wr'), tags: ['remote'] }) },
    { status: 200, body: state(6, { ...entry(7, 'Write'), tags: ['remote'] }) },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  const reply = await updateRunningEntry(qc, { id: 7, description: 'Write' });
  assert.deepEqual(
    sent.map(request => request.request),
    ['GET /api/app/timer', `POST ${EDIT_PATH}`],
  );
  assert.equal(reply.revision, 6);
  assert.equal(isTimerUnknown(qc), false);
});

test('a running-entry edit with an unknown outcome leaves the timer unknown for the next timer write', async t => {
  const qc = withTimer(3);
  const { fetch } = answering({ status: 502, body: 'Bad Gateway' });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Lost' }));
  assert.equal(isTimerUnknown(qc), true);
});

test('a running-entry edit that got no reply keeps the error an entry edit shows', async t => {
  const qc = withTimer(3);
  const lost = new TypeError('Failed to fetch');
  t.mock.method(globalThis, 'fetch', () => Promise.reject(lost));
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Lost' }), (error: unknown) => error === lost);
});

test('a timer action waits for an edit queued behind another edit of the same entry, not failing as offline', async t => {
  const qc = withTimer(3);
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateRunningEntry(qc, { id: 7, description: 'A' });
  const second = updateRunningEntry(qc, { id: 7, description: 'B' });
  await tick();
  const waiting = settleOtherWrites(qc);
  requests[0]!.answer();
  await first;
  await tick();
  requests[1]!.answer();
  await second;
  assert.equal(await waiting, true);
});
