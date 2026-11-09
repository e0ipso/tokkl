import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimeEntry } from '@tokkl/types';
import { duplicateInput } from './duplicateEntry.ts';
import {
  entriesByDay,
  periodTotals,
  presentSelection,
  rangeLabel,
  rowsForDay,
  totalSeconds,
  type StoppedEntry,
} from './entryRows.ts';

let nextId = 1;

function entry(extra: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: nextId++,
    workspace_id: 1,
    project_id: null,
    task_id: null,
    billable: false,
    start: '2026-10-20T09:00:00Z',
    stop: '2026-10-20T10:00:00Z',
    duration: 3600,
    description: 'Write',
    tags: [],
    tag_ids: [],
    all_day: false,
    at: '2026-10-20T10:00:00Z',
    server_deleted_at: null,
    ...extra,
  };
}

const stopped = (extra: Partial<TimeEntry> = {}) => entry(extra) as StoppedEntry;

test('entriesByDay leaves running entries out and puts the newest day first', () => {
  const monday = entry({ start: '2026-10-19T09:00:00Z', stop: '2026-10-19T10:00:00Z' });
  const tuesday = entry();
  const running = entry({ stop: null });
  const days = entriesByDay([monday, tuesday, running], 'UTC');
  assert.deepEqual(
    days.map(({ day, entries }) => [day, entries.map(e => e.id)]),
    [
      ['2026-10-20', [tuesday.id]],
      ['2026-10-19', [monday.id]],
    ],
  );
});

test('entriesByDay takes the day in the account timezone', () => {
  const late = entry({ start: '2026-10-20T23:30:00Z', stop: '2026-10-20T23:45:00Z' });
  assert.equal(entriesByDay([late], 'Europe/Madrid')[0]!.day, '2026-10-21');
});

test('rowsForDay groups similar entries under the oldest id and keeps tag order out of it', () => {
  const older = stopped({ tags: ['b', 'a'] });
  const newer = stopped({ tags: ['a', 'b'] });
  const other = stopped({ description: 'Read' });
  const rows = rowsForDay([newer, older, other], true);
  assert.deepEqual(
    rows.map(row => [row.key, row.entries.length]),
    [
      [String(older.id), 2],
      [String(other.id), 1],
    ],
  );
  assert.equal(rowsForDay([newer, older], false).length, 2);
});

test('rangeLabel spans the timed entries and is empty for no-time ones', () => {
  const format = (iso: string) => iso.slice(11, 16);
  const first = stopped({ start: '2026-10-20T09:00:00Z', stop: '2026-10-20T10:00:00Z' });
  const second = stopped({ start: '2026-10-20T11:00:00Z', stop: '2026-10-20T12:30:00Z' });
  assert.equal(rangeLabel([second, first], format), '09:00 – 12:30');
  assert.equal(rangeLabel([stopped({ all_day: true })], format), '');
});

test('totalSeconds adds start-to-stop seconds', () => {
  assert.equal(totalSeconds([stopped(), stopped({ stop: '2026-10-20T09:30:00Z' })]), 5400);
});

test('presentSelection drops entries that went away and keeps the selection order', () => {
  const a = entry();
  const b = entry();
  assert.deepEqual([...presentSelection(new Set([b.id, 999, a.id]), [a, b])], [b.id, a.id]);
});

test('duplicateInput copies the times, or the day and stored duration of a no-time entry', () => {
  const timed = entry({ description: 'Plan', tags: ['x'], billable: true });
  assert.deepEqual(duplicateInput(timed, 'UTC'), {
    description: 'Plan',
    project_id: null,
    task_id: null,
    tags: ['x'],
    billable: true,
    start: timed.start,
    stop: timed.stop,
  });
  const noTime = entry({ all_day: true, start: '2026-10-19T22:00:00Z', stop: '2026-10-20T00:00:00Z', duration: 7200 });
  assert.deepEqual(duplicateInput(noTime, 'Europe/Madrid'), {
    description: 'Write',
    project_id: null,
    task_id: null,
    tags: [],
    billable: false,
    all_day: true,
    start_date: '2026-10-20',
    duration: 7200,
  });
});

test('periodTotals counts today and the week so far, running entries up to now', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const running = entry({ start: '2026-10-21T11:00:00Z', stop: null });
  const monday = entry({ start: '2026-10-19T09:00:00Z', stop: '2026-10-19T10:00:00Z' });
  const lastWeek = entry({ start: '2026-10-16T09:00:00Z', stop: '2026-10-16T10:00:00Z' });
  const totals = periodTotals([running, monday, lastWeek], now, {
    todayKey: '2026-10-21',
    weekStart: '2026-10-19',
    timeZone: 'UTC',
  });
  assert.deepEqual(totals, { todaySeconds: 3600, weekSeconds: 7200 });
});
