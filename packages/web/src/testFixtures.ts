import type { TimeEntry, TimerPomodoro, TimerState } from '@tokkl/types';

/** A test entry: entry 7, "Write", running since 2026-10-27 10:00 UTC, unless `overrides` say otherwise. */
export function timeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
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
    ...overrides,
  };
}

/** The fields of an entry stopped after an hour on 2026-10-20, 09:00 to 10:00 UTC. */
export const STOPPED = {
  start: '2026-10-20T09:00:00Z',
  stop: '2026-10-20T10:00:00Z',
  duration: 3600,
  at: '2026-10-20T10:00:00Z',
} as const satisfies Partial<TimeEntry>;

/** An idle timer state at `revision`, unless `overrides` say otherwise. */
export function timerState(revision: number, overrides: Partial<TimerState> = {}): TimerState {
  return {
    revision,
    server_time: '2026-10-27T10:00:00.000Z',
    running_entry: null,
    pause: null,
    pomodoro: null,
    discarded_pomodoro: null,
    ...overrides,
  };
}

/** The first work phase of a session on entry 7, 10:00 to 10:25 on 2026-10-27. */
export const POMODORO: TimerPomodoro = {
  work_minutes: 25,
  short_rest_minutes: 5,
  long_rest_minutes: 15,
  long_rest_every: 4,
  phase: { kind: 'work', start: '2026-10-27T10:00:00.000Z', completed: 0, planned_end: '2026-10-27T10:25:00.000Z' },
  upcoming_phase: 'shortRest',
  transition: 'workToShortRest',
  number: 1,
  entry_id: 7,
  pomodoro_start: '2026-10-27T10:00:00.000Z',
};
