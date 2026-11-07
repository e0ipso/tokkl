import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { ApiError } from './client.ts';
import { TIMER_ENTRY_OPTIONS, attemptTimerRequest, createTimerOutcome, isUncertain } from './timerOutcome.ts';
import { TIMER_OFFLINE_MESSAGE, TimerActionError } from './timerState.ts';
import type { TimeEntry, TimerState } from './types.ts';

const running = (id: number): TimeEntry => ({
  id,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T10:00:00.000Z',
  stop: null,
  duration: -1,
  description: '',
  tags: [],
  tag_ids: [],
  at: '2026-10-27T10:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
});

const state = (entry: TimeEntry | null): TimerState => ({
  revision: 1,
  server_time: '2026-10-27T10:00:00.000Z',
  running_entry: entry,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});

const offline = () => new TypeError('Failed to fetch');

/** An outcome whose reads return `replies` in turn, a function reply throwing what it returns. */
function tracked(...replies: Array<TimerState | (() => Error)>) {
  let reads = 0;
  const outcome = createTimerOutcome(async () => {
    const reply = replies[reads++];
    if (reply === undefined) throw new Error('No read expected');
    if (typeof reply === 'function') throw reply();
    return reply;
  });
  return { outcome, reads: () => reads };
}

test('a request that got no reply fails with the offline message; others pass through', async () => {
  await assert.rejects(
    attemptTimerRequest(() => Promise.reject(offline())),
    error => error instanceof TimerActionError && error.kind === 'offline' && error.message === TIMER_OFFLINE_MESSAGE,
  );
  const refused = new ApiError(400, 'Bad request');
  await assert.rejects(
    attemptTimerRequest(() => Promise.reject(refused)),
    error => error === refused,
  );
  assert.equal(await attemptTimerRequest(() => Promise.resolve(5)), 5);
});

test('only a write that got no reply leaves the timer unknown', () => {
  assert.equal(isUncertain(new TimerActionError('offline')), true);
  assert.equal(isUncertain(new TimerActionError('conflict')), false);
  assert.equal(isUncertain(new ApiError(500, 'Server error')), false);
  // A raw TypeError never reaches the outcome: attemptTimerRequest turns it into the offline error first.
  assert.equal(isUncertain(offline()), false);
});

test('a start goes out without a read while the outcome of every write is known', async () => {
  const { outcome, reads } = tracked();
  assert.equal(await outcome.mayStart(null), true);
  outcome.failed(new ApiError(400, 'Bad request'));
  assert.equal(await outcome.mayStart(7), true);
  assert.equal(reads(), 0);
});

test('after a start that got no reply, the next start reads the state and stops if an entry now runs', async () => {
  const { outcome, reads } = tracked(state(running(9)));
  outcome.failed(new TimerActionError('offline'));
  // The lost start reached the server after all: entry 9 runs, so a second start would duplicate it.
  assert.equal(await outcome.mayStart(null), false);
  assert.equal(reads(), 1);
  // The read settled it; the user's next start goes out without another read.
  assert.equal(await outcome.mayStart(9), true);
  assert.equal(reads(), 1);
});

test('after a lost write, a start goes out when the server runs what the user saw', async () => {
  const idle = tracked(state(null));
  idle.outcome.failed(new TimerActionError('offline'));
  assert.equal(await idle.outcome.mayStart(null), true);

  // A Continue while entry 4 runs, after a Stop of 4 that got no reply: the stop did land.
  const stopped = tracked(state(null), state(running(4)));
  stopped.outcome.failed(new TimerActionError('offline'));
  assert.equal(await stopped.outcome.mayStart(4), false);
  stopped.outcome.failed(new TimerActionError('offline'));
  assert.equal(await stopped.outcome.mayStart(4), true);
});

test('a read that fails keeps the timer unknown and fails the start as offline', async () => {
  const { outcome, reads } = tracked(offline, state(null));
  outcome.failed(new TimerActionError('offline'));
  await assert.rejects(outcome.mayStart(null), error => error instanceof TimerActionError && error.kind === 'offline');
  assert.equal(await outcome.mayStart(null), true);
  assert.equal(reads(), 2);
});

test('a timer entry write runs at once while the browser reports being offline', async t => {
  onlineManager.setOnline(false);
  t.after(() => onlineManager.setOnline(true));
  const qc = new QueryClient();
  const sentAt: number[] = [];
  const write = (options: object) =>
    qc
      .getMutationCache()
      .build(qc, {
        ...options,
        mutationFn: () => {
          sentAt.push(Date.now());
          return attemptTimerRequest(() => Promise.reject(offline()));
        },
      })
      .execute(undefined);
  await assert.rejects(write(TIMER_ENTRY_OPTIONS), (error: unknown) => isUncertain(error));
  assert.equal(sentAt.length, 1);
  // The default network mode holds the write instead, to send it whenever the connection returns.
  const held = write({});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sentAt.length, 1);
  assert.equal(qc.getMutationCache().getAll().at(-1)?.state.isPaused, true);
  // A mounted client (main.tsx) resumes held writes when the browser comes back online.
  onlineManager.setOnline(true);
  void qc.resumePausedMutations();
  await assert.rejects(held);
  assert.equal(sentAt.length, 2);
});
