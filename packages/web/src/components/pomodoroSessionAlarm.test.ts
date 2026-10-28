import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimerPomodoro } from '../api/types.ts';
import { phaseAlarm } from './pomodoroSessionAlarm.ts';

const pomodoro: TimerPomodoro = {
  work_minutes: 25, short_rest_minutes: 5, long_rest_minutes: 15, long_rest_every: 4,
  phase: { kind: 'work', start: '2026-10-27T10:00:00.000Z', completed: 0, planned_end: '2026-10-27T10:25:00.000Z' },
  upcoming_phase: 'shortRest', transition: 'workToShortRest', number: 1, entry_id: 7,
  pomodoro_start: '2026-10-27T10:00:00.000Z',
};

test('no session rings nothing', () => {
  assert.equal(phaseAlarm(null, Date.parse('2026-10-27T11:00:00.000Z')), null);
  assert.equal(phaseAlarm(undefined, Date.parse('2026-10-27T11:00:00.000Z')), null);
});

test('a phase rings from its planned end on, keyed by the phase start, with the server transition', () => {
  assert.equal(phaseAlarm(pomodoro, Date.parse('2026-10-27T10:24:59.999Z')), null);
  const expected = { key: '2026-10-27T10:00:00.000Z', transition: 'workToShortRest' };
  assert.deepEqual(phaseAlarm(pomodoro, Date.parse('2026-10-27T10:25:00.000Z')), expected);
  assert.deepEqual(phaseAlarm(pomodoro, Date.parse('2026-10-27T10:40:00.000Z')), expected);
});

test('the next phase rings under a new key, so a confirmed phase stops the old alarm', () => {
  const rest: TimerPomodoro = {
    ...pomodoro,
    phase: { kind: 'shortRest', start: '2026-10-27T10:31:00.000Z', completed: 1, planned_end: '2026-10-27T10:36:00.000Z' },
    upcoming_phase: 'work', transition: 'shortRestToWork',
  };
  assert.equal(phaseAlarm(rest, Date.parse('2026-10-27T10:31:00.000Z')), null);
  assert.deepEqual(phaseAlarm(rest, Date.parse('2026-10-27T10:36:00.000Z')),
    { key: '2026-10-27T10:31:00.000Z', transition: 'shortRestToWork' });
});
