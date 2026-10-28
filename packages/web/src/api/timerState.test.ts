import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import type { TimeEntry, TimerState } from './types.ts';
import {
  TIMER_ACTION_KEY, TIMER_CONFLICT_MESSAGE, TIMER_OFFLINE_MESSAGE, TimerActionError, explainTimerActionError, isTimerState,
  planTimerUpdate, revisionToSend, settleOtherWrites,
} from './timerState.ts';
import { ApiError } from './client.ts';
import { clockOffset, serverNow } from './serverClock.ts';

const entry: TimeEntry = {
  id: 7, workspace_id: 1, project_id: null, task_id: null, billable: false, start: '2026-10-27T10:00:00.000Z',
  stop: null, duration: -1, description: 'Write', tags: [], tag_ids: [], at: '2026-10-27T10:00:00.000Z', server_deleted_at: null,
};

function state(revision: number, overrides: Partial<TimerState> = {}): TimerState {
  return {
    revision, server_time: '2026-10-27T10:00:05.000Z', running_entry: entry, pause: null, pomodoro: null,
    discarded_pomodoro: null, ...overrides,
  };
}

test('a state with a lower revision than the cached one is dropped; an equal or higher one is kept', () => {
  assert.equal(planTimerUpdate(state(5), state(4), 0), null);
  assert.equal(planTimerUpdate(state(5), state(5), 0)?.changed, false);
  assert.equal(planTimerUpdate(state(5), state(6), 0)?.changed, true);
  // Nothing cached yet: any state is the first, and it is not a change to refresh lists for.
  assert.equal(planTimerUpdate(undefined, state(1), 0)?.changed, false);
});

test('the current entry comes from the state, and no running entry clears it', () => {
  assert.equal(planTimerUpdate(undefined, state(1), 0)?.current, entry);
  assert.equal(planTimerUpdate(state(1), state(2, { running_entry: null }), 0)?.current, null);
});

test('the clock offset is the server time minus the local time at arrival', () => {
  const server = Date.parse('2026-10-27T10:00:05.000Z');
  assert.equal(clockOffset('2026-10-27T10:00:05.000Z', server - 3000), 3000);
  assert.equal(clockOffset('2026-10-27T10:00:05.000Z', server + 2000), -2000);
  assert.equal(clockOffset('not a date', 0), null);
  assert.equal(serverNow(1_000_000, 3000).getTime(), 1_003_000);
  assert.equal(planTimerUpdate(undefined, state(1), server - 3000)?.offset, 3000);
});

test('only objects shaped like a timer state pass the guard', () => {
  assert.equal(isTimerState(state(1)), true);
  assert.equal(isTimerState(null), false);
  assert.equal(isTimerState('x'), false);
  assert.equal(isTimerState({ revision: '1', server_time: 'x' }), false);
  assert.equal(isTimerState({ error: 'Conflict' }), false);
});

test('a 409 carrying a state explains itself and hands the state over; other failures pass through', () => {
  const current = state(9);
  const conflict = explainTimerActionError(new ApiError(409, JSON.stringify(current), current));
  assert.ok(conflict instanceof TimerActionError);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.message, TIMER_CONFLICT_MESSAGE);
  assert.equal(conflict.state, current);

  const offline = explainTimerActionError(new TypeError('Failed to fetch'));
  assert.ok(offline instanceof TimerActionError);
  assert.equal(offline.kind, 'offline');
  assert.equal(offline.message, TIMER_OFFLINE_MESSAGE);

  const other = new ApiError(409, 'Conflict', 'Conflict');
  assert.equal(explainTimerActionError(other), other);
  const bad = new ApiError(400, 'Invalid revision', 'Invalid revision');
  assert.equal(explainTimerActionError(bad), bad);
  const unknown = new RangeError('x');
  assert.equal(explainTimerActionError(unknown), unknown);
});

/** Starts a mutation in `qc` that stays pending until the returned function is called. */
function pendingWrite(qc: QueryClient, mutationKey?: readonly unknown[]): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  void qc.getMutationCache().build(qc, { mutationKey, mutationFn: () => held }).execute(undefined);
  return release;
}

test('with no write in flight there is nothing to wait for', async () => {
  const qc = new QueryClient();
  assert.equal(await settleOtherWrites(qc), false);
});

test('a write in flight, such as an edit of the running entry, is waited for, because it moves the revision', async () => {
  const qc = new QueryClient();
  const release = pendingWrite(qc);
  let settled = false;
  const waiting = settleOtherWrites(qc).then((waited) => { settled = true; return waited; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false, 'still waiting while the edit is pending');
  release();
  assert.equal(await waiting, true);
});

test('another timer action in flight is not waited for, so an action never waits for itself', async () => {
  const qc = new QueryClient();
  const release = pendingWrite(qc, TIMER_ACTION_KEY);
  try {
    assert.equal(await settleOtherWrites(qc), false);
  } finally {
    release();
  }
});

test('a write held for the connection fails the action as offline instead of sending it after reconnect', async (t) => {
  const qc = new QueryClient();
  onlineManager.setOnline(false);
  t.after(() => onlineManager.setOnline(true));
  const release = pendingWrite(qc);
  try {
    await assert.rejects(settleOtherWrites(qc), (error: unknown) =>
      error instanceof TimerActionError && error.kind === 'offline' && error.message === TIMER_OFFLINE_MESSAGE);
  } finally {
    release();
  }
});

test('a write that the connection holds while the action waits for it fails the action as offline', async (t) => {
  const qc = new QueryClient();
  t.after(() => onlineManager.setOnline(true));
  // The edit fails once and is held for its retry while the browser is offline.
  let calls = 0;
  void qc.getMutationCache().build(qc, {
    retry: 1, retryDelay: 0,
    mutationFn: () => {
      calls += 1;
      if (calls === 1) {
        onlineManager.setOnline(false);
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve();
    },
  }).execute(undefined);
  await assert.rejects(settleOtherWrites(qc), (error: unknown) => error instanceof TimerActionError && error.kind === 'offline');
});

const phase = (start: string) => ({
  work_minutes: 25, short_rest_minutes: 5, long_rest_minutes: 15, long_rest_every: 4,
  phase: { kind: 'work' as const, start, completed: 0, planned_end: '2026-10-27T10:25:00.000Z' },
  upcoming_phase: 'shortRest' as const, transition: 'workToShortRest' as const, number: 1, entry_id: 7,
  pomodoro_start: start,
});

test("after this tab's own edit, an action confirms the phase the user saw at the edit's new revision", () => {
  const seen = state(4, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  const edited = state(5, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  assert.equal(revisionToSend(seen, edited), 5);
});

test('when the phase or pause changed meanwhile, the action keeps the revision the user saw, so the server refuses it', () => {
  const seen = state(4, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  assert.equal(revisionToSend(seen, state(6, { pomodoro: phase('2026-10-27T10:26:00.000Z') })), 4);
  assert.equal(revisionToSend(seen, state(6)), 4, 'the session ended');
  const pause = {
    paused: true, seconds: 60, workspace_id: 1, description: '', project_id: null, task_id: null, tag_ids: [], tags: [],
    billable: false, clone_entry_id: null,
  };
  const paused = state(4, { running_entry: null, pause });
  assert.equal(revisionToSend(paused, state(5, { running_entry: null, pause })), 5);
  assert.equal(revisionToSend(paused, state(5, { pause: { ...pause, paused: false, clone_entry_id: 8 } })), 4, 'resumed elsewhere');
  assert.equal(revisionToSend(paused, state(5, { running_entry: null })), 4, 'discarded elsewhere');
});
