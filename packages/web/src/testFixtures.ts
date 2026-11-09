import type { TimeEntry } from '@tokkl/types';

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
