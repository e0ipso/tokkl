import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { updateEntry, updateRunningEntry } from './entries.ts';
import { keys } from './keys.ts';
import { TimerActionError, settleOtherWrites } from './timerState.ts';
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
 * answered with the entry; a running-entry edit with a state at the revision after the one sent,
 * running entry 7.
 */
function holding() {
  const requests: Array<{ path: string; body: Record<string, unknown>; answer: () => void }> = [];
  const fetch = (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const description = String(body.description);
    const reply =
      path === EDIT_PATH
        ? state(Number(body.revision) + 1, entry(7, description))
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
  assert.equal((await other).description, 'Other');
  requests[0]!.answer();
  assert.equal((await first).description, 'Wri');
  await tick();
  assert.deepEqual(
    requests.map(request => request.body.description),
    ['Wri', 'Other', 'Write'],
  );
  assert.equal(requests[2]!.path, EDIT_PATH);
  requests[2]!.answer();
  assert.equal((await second).running_entry?.description, 'Write');
});

test('a running-entry edit goes through the timer at the seen revision; the next one sends the revision it moved to', async t => {
  const qc = withTimer(3);
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateRunningEntry(qc, { id: 7, description: 'Write', tags: ['a'], project_id: null });
  const second = updateRunningEntry(qc, { id: 7, billable: true, description: 'Write' });
  await tick();
  assert.deepEqual(
    requests.map(request => [request.path, request.body]),
    [[EDIT_PATH, { description: 'Write', tags: ['a'], project_id: null, revision: 3 }]],
  );
  requests[0]!.answer();
  await first;
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 4, 'the reply is the new timer state');
  await tick();
  assert.deepEqual(requests[1]?.body, { billable: true, description: 'Write', revision: 4 });
  requests[1]!.answer();
  await second;
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 5);
});

/** A fetch that answers each request with the next of `replies` and records the bodies sent. */
function answering(...replies: Array<{ status: number; body: unknown }>) {
  const sent: Array<Record<string, unknown>> = [];
  const fetch = (_path: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const reply = replies.shift();
    if (!reply) return Promise.reject(new Error('No reply left'));
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch, sent };
}

const isConflict = (error: unknown) => error instanceof TimerActionError && error.kind === 'conflict';

test('a running-entry edit that conflicts only because the revision moved goes out once more and keeps the typing', async t => {
  const qc = withTimer(3);
  // Another device tagged entry 7: the revision moved, the entry did not.
  const tagged = state(6, { ...entry(7, 'Wr'), tags: ['remote'] });
  const saved = state(7, { ...entry(7, 'Write'), tags: ['remote'] });
  const { fetch, sent } = answering({ status: 409, body: tagged }, { status: 200, body: saved });
  t.mock.method(globalThis, 'fetch', fetch);
  const reply = await updateRunningEntry(qc, { id: 7, description: 'Write' });
  assert.deepEqual(sent, [
    { description: 'Write', revision: 3 },
    { description: 'Write', revision: 6 },
  ]);
  assert.equal(reply.revision, 7);
  const cached = qc.getQueryData<TimerState>(keys.timer)?.running_entry;
  assert.equal(cached?.description, 'Write', 'the typed description is saved, not dropped');
  assert.deepEqual(cached?.tags, ['remote'], 'the change from the other device stays');
});

test('a running-entry edit whose retry conflicts too fails with the conflict and is not sent a third time', async t => {
  const qc = withTimer(3);
  const { fetch, sent } = answering(
    { status: 409, body: state(6, entry(7, 'Wr')) },
    { status: 409, body: state(8, entry(7, 'Wr')) },
  );
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Write' }), isConflict);
  assert.equal(sent.length, 2);
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.revision, 8);
});

test('a running-entry edit that conflicts because another entry runs fails with the conflict, without a resend', async t => {
  const qc = withTimer(3);
  const current = state(6, entry(9, 'Started elsewhere'));
  const { fetch, sent } = answering({ status: 409, body: current });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Late' }), isConflict);
  assert.equal(sent.length, 1, 'the edit never goes to entry 9');
  assert.deepEqual(qc.getQueryData<TimerState>(keys.timer), current);
});

test('a running-entry edit that conflicts because nothing runs fails with the conflict, without a resend', async t => {
  const qc = withTimer(3);
  const { fetch, sent } = answering({ status: 409, body: state(6, null) });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(updateRunningEntry(qc, { id: 7, description: 'Late' }), isConflict);
  assert.equal(sent.length, 1);
  assert.equal(qc.getQueryData<TimerState>(keys.timer)?.running_entry, null);
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
