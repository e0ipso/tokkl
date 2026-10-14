import { readFileSync } from 'node:fs';
import { ACCOUNT_TIME_ZONE, accountTime } from '../e2e/transfer-tests-helpers.ts';

// The data behind the README screenshots: e2e/fixtures-data/transfer/restore-full.json, one more
// client with two projects, five weeks of weekday entries and one running timer. Everything is
// fixed relative to NOW, which both the server and the browser use as the current time.

export const TIME_ZONE = ACCOUNT_TIME_ZONE;
/** Thursday 16 July 2026, 15:20 in Europe/Madrid. */
export const NOW = '2026-07-16T13:20:00.000Z';
const TODAY = '2026-07-16';
/** The Monday four weeks before TODAY's week, so entries cover five weeks up to TODAY. */
const FIRST_DAY = '2026-06-15';

interface ExportEntry {
  id: number;
  description: string;
  start: string;
  stop: string | null;
  project_id: number | null;
  task_id: number | null;
  billable: boolean;
  tag_ids: number[];
  created_with?: string;
}

interface ExportDocument {
  format: string;
  version: number;
  clients: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  time_entries: ExportEntry[];
}

// IDs from restore-full.json, plus the ones added below.
const PROJECT = { website: 21, roadmap: 22, billing: 24, mobile: 25 } as const;
const TASK = { design: 31, onboarding: 33 } as const;
const TAG = { ux: 41, ops: 42, meeting: 43, review: 44 } as const;
const BILLABLE: Record<number, boolean> = { [PROJECT.website]: true, [PROJECT.roadmap]: false, [PROJECT.billing]: true, [PROJECT.mobile]: true };

const EXTRA_CLIENTS = [{ id: 13, name: 'Northwind', notes: null, archived: false }];
const EXTRA_PROJECTS = [
  {
    id: PROJECT.billing, name: 'Billing API', client_id: 13, color: '#9e5bd9', active: true, is_private: false,
    billable: true, estimated_hours: 120, rate: 95, currency: 'EUR', fixed_fee: null,
    start_date: '2026-05-04', end_date: null, template: false,
  },
  {
    id: PROJECT.mobile, name: 'Mobile app', client_id: 13, color: '#e36a00', active: true, is_private: false,
    billable: true, estimated_hours: 80, rate: 90, currency: 'EUR', fixed_fee: null,
    start_date: '2026-05-04', end_date: null, template: false,
  },
];
const EXTRA_TASKS = [{ id: TASK.onboarding, name: 'Onboarding', project_id: PROJECT.mobile, active: true, estimated_seconds: 72000 }];
const EXTRA_TAGS = [{ id: TAG.meeting, name: 'meeting' }, { id: TAG.review, name: 'review' }];

type Block = readonly [start: string, stop: string, description: string, project: number, task: number | null, tags: readonly number[]];

/** One plan per weekday, Monday first. */
const WEEK: ReadonlyArray<readonly Block[]> = [
  [
    ['09:00', '09:45', 'Sprint kickoff', PROJECT.billing, null, [TAG.meeting]],
    ['10:00', '12:45', 'Invoice export endpoint', PROJECT.billing, null, []],
    ['14:00', '17:30', 'Homepage hero and navigation', PROJECT.website, TASK.design, [TAG.ux]],
  ],
  [
    ['09:15', '12:00', 'Push notification settings', PROJECT.mobile, null, []],
    ['12:15', '13:00', 'Code review', PROJECT.billing, null, [TAG.review]],
    ['14:00', '16:30', 'Checkout page layout', PROJECT.website, TASK.design, [TAG.ux]],
    ['16:45', '18:00', 'Release checklist', PROJECT.billing, null, [TAG.ops]],
  ],
  [
    // Same as the Planning entry in restore-full.json, which covers 15 July.
    ['09:00', '10:00', 'Planning', PROJECT.roadmap, null, [TAG.ux, TAG.ops]],
    ['10:15', '13:00', 'Onboarding screens', PROJECT.mobile, TASK.onboarding, [TAG.ux]],
    ['14:00', '15:30', 'Client call', PROJECT.website, null, [TAG.meeting]],
    ['15:45', '18:00', 'Webhook retries', PROJECT.billing, null, []],
  ],
  [
    ['09:00', '11:30', 'Homepage hero and navigation', PROJECT.website, TASK.design, [TAG.ux]],
    ['11:45', '12:30', 'Code review', PROJECT.billing, null, [TAG.review]],
    ['13:15', '14:00', 'Release checklist', PROJECT.billing, null, [TAG.ops]],
    ['14:15', '17:45', 'Offline sync', PROJECT.mobile, null, []],
  ],
  [
    ['09:30', '12:30', 'Offline sync', PROJECT.mobile, null, []],
    ['13:30', '14:30', 'Weekly notes', PROJECT.roadmap, null, []],
    ['14:45', '15:45', 'Retro', PROJECT.billing, null, [TAG.meeting]],
  ],
];

/** The timer running at NOW. */
const RUNNING: Block = ['14:05', '', 'Checkout page layout', PROJECT.website, TASK.design, [TAG.ux]];

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Monday is 0. Calendar dates only, so UTC is safe here. */
function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number) as [number, number];
  return hours * 60 + mins;
}

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function entry(id: number, date: string, block: Block, stop: string | null): ExportEntry {
  const [start, , description, project, task, tags] = block;
  return {
    id, description, project_id: project, task_id: task, billable: BILLABLE[project] ?? false, tag_ids: [...tags],
    start: accountTime(date, `${start}:00`),
    stop: stop === null ? null : accountTime(date, `${stop}:00`),
    created_with: 'screenshots',
  };
}

/** Weekday entries from FIRST_DAY to TODAY, ending before NOW, plus the running timer. */
function generatedEntries(fixture: readonly ExportEntry[]): ExportEntry[] {
  const taken = new Set(fixture.map((row) => `${row.description}|${Date.parse(row.start)}`));
  const nowMs = Date.parse(NOW);
  const rows: ExportEntry[] = [];
  let id = 100;
  for (let date = FIRST_DAY, day = 0; date <= TODAY; date = addDays(date, 1), day++) {
    const plan = WEEK[weekdayIndex(date)] ?? [];
    plan.forEach((block, index) => {
      // Trim 0, 10 or 20 minutes off the end so the weeks do not look identical. Every block is
      // followed by a gap of at least 15 minutes, so a trimmed block never overlaps the next.
      const stop = clock(minutes(block[1]) - ((day + index) % 3) * 10);
      const row = entry(id++, date, block, stop);
      if (Date.parse(row.stop!) > nowMs || taken.has(`${row.description}|${Date.parse(row.start)}`)) return;
      rows.push(row);
    });
  }
  rows.push(entry(id, TODAY, RUNNING, null));
  return rows;
}

/** restore-full.json with the extra client, projects, tasks, tags and entries appended. */
export function screenshotExport(): ExportDocument {
  const path = new URL('../e2e/fixtures-data/transfer/restore-full.json', import.meta.url);
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as ExportDocument;
  return {
    ...fixture,
    clients: [...fixture.clients, ...EXTRA_CLIENTS],
    projects: [...fixture.projects, ...EXTRA_PROJECTS],
    tasks: [...fixture.tasks, ...EXTRA_TASKS],
    tags: [...fixture.tags, ...EXTRA_TAGS],
    time_entries: [...fixture.time_entries, ...generatedEntries(fixture.time_entries)],
  };
}
