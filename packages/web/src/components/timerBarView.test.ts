import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeEntry, TimerPause, TimerPomodoro, TimerState } from '../api/types.ts';
import { descriptionPlaceholder, pauseAnnouncement, timerBarClass, timerBarView } from './timerBarView.ts';

const entry: TimeEntry = {
  id: 7,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T10:00:00.000Z',
  stop: null,
  duration: -1,
  description: 'Write',
  tags: [],
  tag_ids: [],
  at: '2026-10-27T10:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
};

const pause: TimerPause = {
  paused: true,
  seconds: 60,
  workspace_id: 1,
  description: 'Write',
  project_id: null,
  task_id: null,
  tag_ids: [],
  tags: [],
  billable: false,
  clone_entry_id: null,
};

function state(overrides: Partial<TimerState>): TimerState {
  return {
    revision: 1,
    server_time: '2026-10-27T10:00:05.000Z',
    running_entry: null,
    pause: null,
    pomodoro: null,
    discarded_pomodoro: null,
    ...overrides,
  };
}

test('a running entry wins over the manual preference', () => {
  const view = timerBarView(state({ running_entry: entry }), true);
  assert.equal(view.mode, 'running');
  assert.equal(view.manualMode, false);
  assert.equal(timerBarClass(view.mode), 'timer-bar is-running');
});

test("a Pomodoro session's entry is left to the Pomodoro page", () => {
  const pomodoro = {} as TimerPomodoro;
  const view = timerBarView(state({ running_entry: entry, pomodoro }), false);
  assert.equal(view.mode, 'idle');
  assert.equal(view.current, null);
});

test('a paused chain shows paused and is announced', () => {
  const view = timerBarView(state({ pause }), true);
  assert.equal(view.mode, 'paused');
  assert.equal(pauseAnnouncement(view), 'Timer paused');
  assert.equal(descriptionPlaceholder(view.mode), 'Add a description');
});

test('the entry that continues a chain is announced as resumed', () => {
  const resumed = timerBarView(
    state({ running_entry: entry, pause: { ...pause, paused: false, clone_entry_id: 7 } }),
    false,
  );
  assert.equal(pauseAnnouncement(resumed), 'Timer resumed');
  assert.equal(pauseAnnouncement(timerBarView(state({ running_entry: entry }), false)), '');
});

test('idle follows the manual preference', () => {
  assert.equal(timerBarView(undefined, true).mode, 'manual');
  assert.equal(descriptionPlaceholder('manual'), 'What did you work on?');
  assert.equal(timerBarView(undefined, false).mode, 'idle');
  assert.equal(timerBarClass('idle'), 'timer-bar');
});
