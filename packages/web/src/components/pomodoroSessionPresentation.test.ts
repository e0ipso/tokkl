import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimerPomodoro, TimerState } from '../api/types.ts';
import { countdown, createDiscardNotices, sessionTitle } from './pomodoroSessionPresentation.ts';

const pomodoro: TimerPomodoro = {
  work_minutes: 25, short_rest_minutes: 5, long_rest_minutes: 15, long_rest_every: 4,
  phase: { kind: 'work', start: '2026-10-27T10:00:00.000Z', completed: 0, planned_end: '2026-10-27T10:25:00.000Z' },
  upcoming_phase: 'shortRest', transition: 'workToShortRest', number: 1, entry_id: 7,
  pomodoro_start: '2026-10-27T10:00:00.000Z',
};

function state(revision: number, discarded: number | null): TimerState {
  return {
    revision, server_time: '2026-10-27T10:00:00.000Z', running_entry: null, pause: null, pomodoro: null,
    discarded_pomodoro: discarded === null ? null
      : { entry_id: discarded, start: '2026-10-27T10:00:00.000Z', stop: '2026-10-27T10:00:00.000Z' },
  };
}

test('the countdown rounds remaining time up and overtime down, to whole seconds', () => {
  const end = pomodoro.phase.planned_end;
  assert.deepEqual(countdown(end, new Date('2026-10-27T10:00:00.000Z')), { overtime: false, seconds: 1500 });
  assert.deepEqual(countdown(end, new Date('2026-10-27T10:24:59.001Z')), { overtime: false, seconds: 1 });
  assert.deepEqual(countdown(end, new Date('2026-10-27T10:25:00.000Z')), { overtime: false, seconds: 0 });
  assert.deepEqual(countdown(end, new Date('2026-10-27T10:25:00.999Z')), { overtime: true, seconds: 0 });
  assert.deepEqual(countdown(end, new Date('2026-10-27T10:26:05.500Z')), { overtime: true, seconds: 65 });
});

test('the title shows the phase and its countdown from the server planned end', () => {
  assert.equal(sessionTitle(pomodoro, new Date('2026-10-27T10:00:01.000Z')), 'Work · 24:59 · Tokkl');
  const rest = { ...pomodoro, phase: { ...pomodoro.phase, kind: 'shortRest' as const } };
  assert.equal(sessionTitle(rest, new Date('2026-10-27T10:26:05.000Z')), 'Short rest · +1:05 overtime · Tokkl');
});

test('a discarded pomodoro is announced once, and one already there when the tab loads is not', () => {
  const notices = createDiscardNotices();
  assert.equal(notices(state(4, 70)), false, 'the first state only records what was already discarded');
  assert.equal(notices(state(5, null)), false);
  assert.equal(notices(state(6, 71)), true);
  assert.equal(notices(state(6, 71)), false, 'the same state again, from the stream or a poll');
  assert.equal(notices(state(7, null)), false);
  assert.equal(notices(state(8, 72)), true);
});

test('a discard in the first state after a tab loaded with none is announced', () => {
  const notices = createDiscardNotices();
  assert.equal(notices(state(1, null)), false);
  assert.equal(notices(state(2, 9)), true);
});
