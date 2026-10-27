import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeEntry, TimerState } from './types.ts';
import {
  TIMER_CONFLICT_MESSAGE, TIMER_OFFLINE_MESSAGE, TimerActionError, explainTimerActionError, isTimerState, planTimerUpdate,
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
