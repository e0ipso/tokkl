import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { fileBackedCopy, setup, type TestContext } from './helpers.ts';
import { formatDuration, parseDuration } from '@timetrack/common/duration';
import { transaction } from '../src/db/index.ts';
import { parseCsv } from '../src/lib/csv.ts';
import { CSV_COLUMNS } from '../src/services/export.ts';

async function seed(ctx: TestContext) {
  const base = `/api/v9/workspaces/${ctx.wid}`;
  await ctx.json('PUT', base, { default_hourly_rate: 50, default_currency: 'EUR' });
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME' });
  const alpha = await ctx.json('POST', `${base}/projects`, { name: 'Alpha', client_id: client.body.id, billable: true, rate: 100 });
  const beta = await ctx.json('POST', `${base}/projects`, { name: 'Beta' });
  const add = (start: string, seconds: number, extra: Record<string, unknown>) =>
    ctx.json('POST', `${base}/time_entries`, { start, duration: seconds, created_with: 'test', ...extra });
  await add('2026-10-05T08:00:00Z', 3600, { project_id: alpha.body.id, description: 'Build', tags: ['dev'] });
  await add('2026-10-05T10:00:00Z', 1800, { project_id: alpha.body.id, description: 'Build', tags: ['dev'] });
  await add('2026-10-06T08:00:00Z', 7200, { project_id: beta.body.id, description: 'Research' });
  await add('2026-10-07T08:00:00Z', 900, { description: 'Email' });
  // Outside the range used below.
  await add('2026-09-01T08:00:00Z', 600, { description: 'Old' });
  // Running entries are left out of reports.
  await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-06T12:00:00Z', duration: -1 });
  return { alpha: alpha.body, beta: beta.body, client: client.body };
}

test('summary report groups by project with description sub-groups', async () => {
  const ctx = await setup();
  const { alpha, beta } = await seed(ctx);
  const res = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/summary/time_entries`, {
    start_date: '2026-10-05', end_date: '2026-10-11', grouping: 'projects', sub_grouping: 'time_entries',
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-grouping'), 'projects');
  const byId = new Map(res.body.groups.map((g: any) => [g.id, g]));
  const alphaGroup: any = byId.get(alpha.id);
  assert.deepEqual(alphaGroup.sub_groups, [{ id: null, title: 'Build', seconds: 5400 }]);
  assert.equal((byId.get(beta.id) as any).sub_groups[0].seconds, 7200);
  assert.equal((byId.get(null) as any).sub_groups[0].title, 'Email');
});

test('detailed report pages with X-Next-Row-Number and computes amounts', async () => {
  const ctx = await setup();
  await seed(ctx);
  const url = `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`;
  const first = await ctx.json('POST', url, { start_date: '2026-10-05', end_date: '2026-10-11', page_size: 3, order_dir: 'ASC' });
  assert.equal(first.body.length, 3);
  assert.equal(first.headers.get('x-next-row-number'), '4');
  assert.equal(first.body[0].description, 'Build');
  assert.equal(first.body[0].hourly_rate_in_cents, 10000);
  assert.equal(first.body[0].billable_amount_in_cents, 10000);
  assert.equal(first.body[0].time_entries[0].seconds, 3600);

  const second = await ctx.json('POST', url, { start_date: '2026-10-05', end_date: '2026-10-11', page_size: 3, first_row_number: 4, order_dir: 'ASC' });
  assert.equal(second.body.length, 1);
  assert.equal(second.headers.get('x-next-row-number'), null);

  const tooLong = await ctx.json('POST', url, { start_date: '2024-01-01', end_date: '2026-01-01' });
  assert.equal(tooLong.status, 400);
});

test('report filters: project null, tags, billable, description, rounding', async () => {
  const ctx = await setup();
  await seed(ctx);
  const url = `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`;
  const range = { start_date: '2026-10-05', end_date: '2026-10-11' };
  const noProject = await ctx.json('POST', url, { ...range, project_ids: [null] });
  assert.deepEqual(noProject.body.map((r: any) => r.description), ['Email']);
  const dev = await ctx.json('POST', url, { ...range, tag_ids: [1] });
  assert.equal(dev.body.length, 2);
  const billable = await ctx.json('POST', url, { ...range, billable: true });
  assert.equal(billable.body.length, 2);
  const search = await ctx.json('POST', url, { ...range, description: 'resea' });
  assert.equal(search.body.length, 1);
  const rounded = await ctx.json('POST', url, { ...range, description: 'Email', rounding: 1, rounding_minutes: 30 });
  assert.equal(rounded.body[0].time_entries[0].seconds, 1800);
});

test('weekly report returns seven daily buckets per project', async () => {
  const ctx = await setup();
  const { alpha } = await seed(ctx);
  const res = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/weekly/time_entries`, { start_date: '2026-10-05' });
  assert.equal(res.status, 200);
  const row = res.body.find((r: any) => r.project_id === alpha.id);
  assert.deepEqual(row.seconds, [5400, 0, 0, 0, 0, 0, 0]);
});

test('app report endpoint returns totals, series and nested groups', async () => {
  const ctx = await setup();
  await seed(ctx);
  const res = await ctx.json('POST', '/api/app/report', {
    start_date: '2026-10-05', end_date: '2026-10-11', grouping: 'clients', sub_grouping: 'projects',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.totals.seconds, 3600 + 1800 + 7200 + 900);
  assert.equal(res.body.totals.billable_seconds, 5400);
  assert.deepEqual(res.body.totals.amounts, [{ currency: 'EUR', cents: 15000 }]);
  assert.equal(res.body.series.length, 7);
  assert.equal(res.body.series[0].seconds, 5400);
  const acme = res.body.groups.find((g: any) => g.title === 'ACME');
  assert.equal(acme.sub_groups[0].title, 'Alpha');
  // Entries are paged by /api/app/report/entries rather than embedded in the report.
  assert.equal(res.body.entries, undefined);
  const page = await ctx.json('POST', '/api/app/report/entries', { start_date: '2026-10-05', end_date: '2026-10-11' });
  assert.equal(page.body.total, 4);
  assert.equal(page.body.entries.length, 4);
});

test('bounds returns the first and last entry day in the account timezone', async () => {
  const ctx = await setup({ timezone: 'Asia/Tokyo' });
  assert.deepEqual((await ctx.json('GET', '/api/app/bounds')).body, { first_date: null, last_date: null });
  await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: '2025-03-01T20:00:00Z', duration: 60 });
  await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60 });
  // 20:00 UTC on 1 March is already 2 March in Tokyo.
  assert.deepEqual((await ctx.json('GET', '/api/app/bounds')).body, { first_date: '2025-03-02', last_date: '2026-10-01' });
});

test('app report applies the workspace rounding; Toggl v3 only when asked', async () => {
  const ctx = await setup();
  await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: '2026-10-05T08:00:00Z', duration: 600 });
  assert.equal((await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}`, { rounding: 1, rounding_minutes: 7 })).status, 400);
  await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}`, { rounding: 1, rounding_minutes: 15 });
  const range = { start_date: '2026-10-05', end_date: '2026-10-05' };
  assert.equal((await ctx.json('POST', '/api/app/report', range)).body.totals.seconds, 900);
  assert.equal((await ctx.json('POST', '/api/app/report', { ...range, rounding_minutes: 0 })).body.totals.seconds, 600);
  const v3 = `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`;
  assert.equal((await ctx.json('POST', v3, range)).body[0].time_entries[0].seconds, 600);
  assert.equal((await ctx.json('POST', v3, { ...range, rounding: 1 })).body[0].time_entries[0].seconds, 900);
});

test('negated filters keep entries whose field is empty', async () => {
  const ctx = await setup();
  const { alpha } = await seed(ctx);
  const url = `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`;
  const range = { start_date: '2026-10-05', end_date: '2026-10-11', order_dir: 'ASC' };
  const titles = async (body: Record<string, unknown>) =>
    (await ctx.json('POST', url, { ...range, ...body })).body.map((r: any) => r.description);

  assert.deepEqual(await titles({ exclude_project_ids: [alpha.id] }), ['Research', 'Email']);
  assert.deepEqual(await titles({ exclude_project_ids: [null] }), ['Build', 'Build', 'Research']);
  // Tag "dev" has id 1. Untagged entries stay when only "dev" is excluded.
  assert.deepEqual(await titles({ exclude_tag_ids: [1] }), ['Research', 'Email']);
  assert.deepEqual(await titles({ exclude_tag_ids: [null] }), ['Build', 'Build']);
  assert.deepEqual(await titles({ exclude_client_ids: [null] }), ['Build', 'Build']);
});

interface BulkEntry {
  start: string;
  seconds: number;
  projectId?: number | null;
  description?: string;
}

/** Inserts stopped entries straight into the database; thousands of HTTP calls would be too slow. */
function insertEntries(ctx: TestContext, entries: BulkEntry[]): number[] {
  const insert = ctx.db.prepare(`
    INSERT INTO time_entries (workspace_id, user_id, project_id, description, start, stop, created_with, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'test', ?, ?)
  `);
  return transaction(ctx.db, () => entries.map((entry) => {
    const stop = new Date(Date.parse(entry.start) + entry.seconds * 1000).toISOString();
    const result = insert.run(ctx.wid, ctx.user.id, entry.projectId ?? null, entry.description ?? '', entry.start, stop, entry.start, entry.start);
    return Number(result.lastInsertRowid);
  }));
}

test('app CSV exports cover multi-year ranges and match the app report; v3 CSVs keep the 366-day cap', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  await ctx.json('PUT', base, { rounding: 1, rounding_minutes: 15 });
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME' });
  const alpha = (await ctx.json('POST', `${base}/projects`, { name: 'Alpha', client_id: client.body.id })).body;
  const beta = (await ctx.json('POST', `${base}/projects`, { name: 'Beta' })).body;
  insertEntries(ctx, [
    { start: '2023-03-01T08:00:00.000Z', seconds: 3600, projectId: alpha.id, description: 'Y2023' },
    { start: '2024-06-01T08:00:00.000Z', seconds: 1800, projectId: beta.id, description: 'Y2024' },
    { start: '2025-09-01T08:00:00.000Z', seconds: 7200, projectId: alpha.id, description: 'Y2025' },
    // The workspace rounds this up to 15 minutes in the app report, so the CSV must too.
    { start: '2026-01-15T08:00:00.000Z', seconds: 610, description: 'Y2026' },
  ]);
  const range = { start_date: '2023-01-01', end_date: '2026-06-30' };
  const csv = async (path: string, body: Record<string, unknown>) => {
    const res = await ctx.request('POST', path, { ...range, ...body });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/csv/);
    return parseCsv(await res.text());
  };
  const jsonEntries = async (body: Record<string, unknown>) =>
    (await ctx.json('POST', '/api/app/report/entries', { ...range, ...body })).body.entries as any[];
  // Description, start date and duration columns of the detailed CSV.
  const detailedColumns = (rows: string[][]) => rows.slice(1).map((row) => [row[5], row[7], row[11]]);
  const expectedColumns = (entries: any[]) =>
    entries.map((entry) => [entry.description, entry.start.slice(0, 10), formatDuration(entry.seconds)]);

  const all = await csv('/api/app/report/detailed.csv', {});
  assert.deepEqual(all[0], [...CSV_COLUMNS]);
  assert.deepEqual(detailedColumns(all), [
    ['Y2026', '2026-01-15', '0:15:00'],
    ['Y2025', '2025-09-01', '2:00:00'],
    ['Y2024', '2024-06-01', '0:30:00'],
    ['Y2023', '2023-03-01', '1:00:00'],
  ]);
  assert.deepEqual(detailedColumns(all), expectedColumns(await jsonEntries({})));

  const filter = { project_ids: [alpha.id], sort: 'duration', dir: 'asc' };
  const filtered = await csv('/api/app/report/detailed.csv', filter);
  assert.deepEqual(detailedColumns(filtered).map((row) => row[0]), ['Y2023', 'Y2025']);
  assert.deepEqual(detailedColumns(filtered), expectedColumns(await jsonEntries(filter)));

  const grouping = { grouping: 'projects', sub_grouping: 'time_entries' };
  const summary = await csv('/api/app/report/summary.csv', { ...grouping, project_ids: [alpha.id] });
  assert.deepEqual(summary, [['Group', 'Sub group', 'Duration'], ['Alpha', 'Y2025', '2:00:00'], ['Alpha', 'Y2023', '1:00:00']]);
  const allSummary = await csv('/api/app/report/summary.csv', grouping);
  const report = await ctx.json('POST', '/api/app/report', { ...range, ...grouping });
  assert.deepEqual(allSummary.slice(1), report.body.groups.flatMap((group: any) => group.sub_groups.map((sub: any) =>
    [group.title || '(none)', sub.title || '(none)', formatDuration(sub.seconds)])));
  assert.deepEqual(allSummary.slice(1).map((row) => row[1]).sort(), ['Y2023', 'Y2024', 'Y2025', 'Y2026']);

  for (const path of ['/api/app/report/detailed.csv', '/api/app/report/summary.csv']) {
    const anonymous = await ctx.request('POST', path, range, { authorization: '' });
    assert.equal(anonymous.status, 403, path);
  }

  for (const path of ['search/time_entries.csv', 'summary/time_entries.csv']) {
    const url = `/reports/api/v3/workspace/${ctx.wid}/${path}`;
    const year = await ctx.request('POST', url, { start_date: '2024-01-01', end_date: '2024-12-31' });
    assert.equal(year.status, 200, `${path} with 366 days`);
    const tooLong = await ctx.json('POST', url, { start_date: '2024-01-01', end_date: '2025-01-01' });
    assert.equal(tooLong.status, 400, `${path} with 367 days`);
    assert.equal(tooLong.body, 'Maximum allowed date range is 366 days');
  }
});

test('app CSV totals equal the displayed report for each workspace rounding mode; stored and v3 durations stay raw', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const alpha = (await ctx.json('POST', `${base}/projects`, { name: 'Alpha' })).body;
  const beta = (await ctx.json('POST', `${base}/projects`, { name: 'Beta' })).body;
  // Chosen so that up, nearest, down and no rounding give four different totals at 15 minutes.
  const raw = [
    { start: '2026-03-02T08:00:00.000Z', seconds: 610, projectId: alpha.id, description: 'A' },
    { start: '2026-03-02T10:00:00.000Z', seconds: 1000, projectId: alpha.id, description: 'B' },
    { start: '2026-03-03T08:00:00.000Z', seconds: 2000, projectId: beta.id, description: 'C' },
    { start: '2026-03-04T08:00:00.000Z', seconds: 400, description: 'D' },
  ];
  insertEntries(ctx, raw);
  const range = { start_date: '2026-03-01', end_date: '2026-03-07' };
  const grouping = { grouping: 'projects', sub_grouping: 'time_entries' };
  const csv = async (path: string, body: Record<string, unknown> = {}) => {
    const res = await ctx.request('POST', path, { ...range, ...body });
    assert.equal(res.status, 200, path);
    return parseCsv(await res.text());
  };
  const secondsOf = (cell: string | undefined) => {
    const seconds = parseDuration(cell ?? '');
    assert.notEqual(seconds, null, `unparsable duration ${cell}`);
    return seconds!;
  };
  const sumColumn = (rows: string[][], column: number) => rows.slice(1).reduce((total, row) => total + secondsOf(row[column]), 0);
  const storedDurations = async () =>
    (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-03-01&end_date=2026-03-08')).body
      .map((entry: any) => entry.duration).sort((a: number, b: number) => a - b);

  const modes = [
    { name: 'up', rounding: 1, rounding_minutes: 15, total: 900 + 1800 + 2700 + 900 },
    { name: 'nearest', rounding: 0, rounding_minutes: 15, total: 900 + 900 + 1800 + 0 },
    { name: 'down', rounding: -1, rounding_minutes: 15, total: 0 + 900 + 1800 + 0 },
    { name: 'disabled', rounding: 1, rounding_minutes: 0, total: 610 + 1000 + 2000 + 400 },
  ];
  for (const mode of modes) {
    const put = await ctx.json('PUT', base, { rounding: mode.rounding, rounding_minutes: mode.rounding_minutes });
    assert.equal(put.status, 200, mode.name);
    const report = (await ctx.json('POST', '/api/app/report', { ...range, ...grouping })).body;
    assert.equal(report.totals.seconds, mode.total, `${mode.name}: displayed total`);
    const entries = (await ctx.json('POST', '/api/app/report/entries', range)).body.entries as any[];

    const detailed = await csv('/api/app/report/detailed.csv');
    assert.equal(detailed.length - 1, raw.length, `${mode.name}: detailed rows`);
    assert.deepEqual(detailed.slice(1).map((row) => [row[5], secondsOf(row[11])]),
      entries.map((entry) => [entry.description, entry.seconds]), `${mode.name}: detailed rows match the entries`);
    assert.equal(sumColumn(detailed, 11), report.totals.seconds, `${mode.name}: detailed.csv total`);

    const summary = await csv('/api/app/report/summary.csv', grouping);
    assert.deepEqual(summary.slice(1).map((row) => [row[0], row[1], secondsOf(row[2])]),
      report.groups.flatMap((group: any) => group.sub_groups.map((sub: any) => [group.title || '(none)', sub.title || '(none)', sub.seconds])),
      `${mode.name}: summary rows match the groups`);
    assert.equal(sumColumn(summary, 2), report.totals.seconds, `${mode.name}: summary.csv total`);

    assert.deepEqual(await storedDurations(), [400, 610, 1000, 2000], `${mode.name}: stored durations`);
  }

  // Toggl v3 CSVs stay raw unless the request asks for rounding, even with workspace rounding on.
  await ctx.json('PUT', base, { rounding: 1, rounding_minutes: 15 });
  const v3 = `/reports/api/v3/workspace/${ctx.wid}`;
  const rawTotal = 610 + 1000 + 2000 + 400;
  const upTotal = modes[0]!.total;
  assert.equal(sumColumn(await csv(`${v3}/search/time_entries.csv`), 11), rawTotal);
  assert.equal(sumColumn(await csv(`${v3}/summary/time_entries.csv`, grouping), 2), rawTotal);
  assert.equal(sumColumn(await csv(`${v3}/search/time_entries.csv`, { rounding: 1 }), 11), upTotal);
  assert.equal(sumColumn(await csv(`${v3}/summary/time_entries.csv`, { ...grouping, rounding: 1 }), 2), upTotal);
  assert.deepEqual(await storedDurations(), [400, 610, 1000, 2000]);
});

test('app report for the detailed and weekly tabs carries totals without sub-groups or entries', async () => {
  const ctx = await setup();
  const { alpha, beta } = await seed(ctx);
  const range = { start_date: '2026-10-05', end_date: '2026-10-11' };
  // The query packages/web/src/pages/reports/query.ts sends from the detailed and weekly tabs.
  const res = await ctx.json('POST', '/api/app/report', { ...range, grouping: 'projects', sub_grouping: 'projects' });
  assert.equal(res.status, 200);
  assert.equal(res.body.entries, undefined);
  assert.equal(res.body.totals.seconds, 3600 + 1800 + 7200 + 900);
  assert.equal(res.body.totals.entry_count, 4);
  assert.deepEqual(new Set(res.body.groups.map((group: any) => group.id)), new Set([alpha.id, beta.id, null]));
  for (const group of res.body.groups) assert.deepEqual(group.sub_groups, [], `group ${group.id}`);
  const summary = await ctx.json('POST', '/api/app/report', { ...range, grouping: 'projects', sub_grouping: 'time_entries' });
  assert.deepEqual(res.body.totals, summary.body.totals);
});

test('app weekly report totals every entry in long ranges, by project or client', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const acme = (await ctx.json('POST', `${base}/clients`, { name: 'ACME' })).body;
  const other = (await ctx.json('POST', `${base}/clients`, { name: 'Other' })).body;
  const alpha = (await ctx.json('POST', `${base}/projects`, { name: 'Alpha', client_id: acme.id })).body;
  const beta = (await ctx.json('POST', `${base}/projects`, { name: 'Beta' })).body;
  const gamma = (await ctx.json('POST', `${base}/projects`, { name: 'Gamma', client_id: other.id })).body;
  const clientOf = new Map<number | null, number | null>([[alpha.id, acme.id], [beta.id, null], [gamma.id, other.id], [null, null]]);

  // 6000 entries over 181 days, more than the 5000 the old client-side weekly tab could sum.
  const days = 181;
  const seeded = Array.from({ length: 6000 }, (_, i) => {
    const start = Date.UTC(2026, 0, 1) + (i % days) * 86_400_000 + (Math.floor(i / days) % 20) * 3_600_000;
    const projectId = [alpha.id, beta.id, gamma.id, null][i % 4] as number | null;
    return { start: new Date(start).toISOString(), seconds: 60 + ((i * 97) % 3000), projectId };
  });
  insertEntries(ctx, seeded);
  const sum = (keep: (entry: (typeof seeded)[number]) => boolean, round = (seconds: number) => seconds) =>
    seeded.filter(keep).reduce((total, entry) => total + round(entry.seconds), 0);

  const range = { start_date: '2026-01-01', end_date: '2026-06-30' };
  const weekly = async (body: Record<string, unknown> = {}) => {
    const res = await ctx.json('POST', '/api/app/report/weekly', { ...range, ...body });
    assert.equal(res.status, 200);
    return res.body;
  };
  const summaryTotal = async (body: Record<string, unknown> = {}) =>
    (await ctx.json('POST', '/api/app/report', { ...range, ...body })).body.totals.seconds as number;
  /** Each column total equals the entries dated inside that column, and everything adds up to the total. */
  const assertColumns = (grid: any) => {
    grid.columns.forEach((column: { start: string; end: string }, i: number) => {
      const expected = sum((entry) => entry.start.slice(0, 10) >= column.start && entry.start.slice(0, 10) <= column.end);
      assert.equal(grid.column_totals[i], expected, `column ${column.start}`);
    });
    assert.equal(grid.column_totals.reduce((a: number, b: number) => a + b, 0), grid.total);
    assert.equal(grid.rows.reduce((total: number, row: any) => total + row.total, 0), grid.total);
  };

  const all = await weekly();
  assert.equal(all.mode, 'weeks');
  assert.equal(all.total, sum(() => true));
  assert.equal(all.total, await summaryTotal());
  // Weeks start on Monday by default; the first and last columns are clipped to the range.
  assert.deepEqual(all.columns[0], { start: '2026-01-01', end: '2026-01-04' });
  assert.deepEqual(all.columns.at(-1), { start: '2026-06-29', end: '2026-06-30' });
  assertColumns(all);
  for (const row of all.rows) assert.equal(row.total, sum((entry) => entry.projectId === row.id), `project ${row.id}`);
  assert.equal(all.rows.at(-1).id, null);

  const onlyAlpha = await weekly({ project_ids: [alpha.id] });
  assert.deepEqual(onlyAlpha.rows.map((row: any) => row.id), [alpha.id]);
  assert.equal(onlyAlpha.total, sum((entry) => entry.projectId === alpha.id));
  assert.equal(onlyAlpha.total, await summaryTotal({ project_ids: [alpha.id] }));

  const rounding = { rounding: 1, rounding_minutes: 15 };
  const rounded = await weekly(rounding);
  assert.equal(rounded.total, sum(() => true, (seconds) => Math.ceil(seconds / 900) * 900));
  assert.equal(rounded.total, await summaryTotal(rounding));

  const byClient = await weekly({ rows: 'clients' });
  assert.deepEqual(byClient.rows.map((row: any) => row.id).sort(), [acme.id, other.id, null].sort());
  assert.equal(byClient.rows.at(-1).id, null);
  for (const row of byClient.rows) assert.equal(row.total, sum((entry) => clientOf.get(entry.projectId) === row.id), `client ${row.id}`);
  const clientGroups = (await ctx.json('POST', '/api/app/report', { ...range, grouping: 'clients' })).body.groups;
  assert.deepEqual(
    new Map(byClient.rows.map((row: any) => [row.id, row.total])),
    new Map(clientGroups.map((group: any) => [group.id, group.seconds])),
  );
  assert.equal(byClient.total, all.total);

  // The first weekday comes from the account preference.
  assert.equal((await ctx.json('PUT', '/api/v9/me', { beginning_of_week: 0 })).status, 200);
  const sundayWeeks = await weekly();
  assert.deepEqual(sundayWeeks.columns[0], { start: '2026-01-01', end: '2026-01-03' });
  assert.deepEqual(sundayWeeks.columns[1], { start: '2026-01-04', end: '2026-01-10' });
  assertColumns(sundayWeeks);
  assert.equal(sundayWeeks.total, all.total);

  const oneWeek = await weekly({ start_date: '2026-01-05', end_date: '2026-01-11' });
  assert.equal(oneWeek.mode, 'days');
  assert.equal(oneWeek.columns.length, 7);
  assert.equal(oneWeek.total, sum((entry) => entry.start >= '2026-01-05' && entry.start < '2026-01-12'));

  const invalid = await ctx.json('POST', '/api/app/report/weekly', { ...range, rows: 'tags' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body, "Invalid 'rows' value, allowed values are: 'projects, clients'");
});

test('app detailed entries page through every match in a stable global order', async () => {
  const ctx = await setup();
  const total = 600;
  const descriptions = ['alpha', 'bravo', 'charlie', 'delta'];
  // Insert in a scrambled order so ids do not follow start times. Pairs share a start, and
  // durations and descriptions repeat, so every sort has ties for the id to break.
  const ids = insertEntries(ctx, Array.from({ length: total }, (_, i) => {
    const n = (i * 7919) % total;
    return {
      start: new Date(Date.UTC(2026, 2, 1) + Math.floor(n / 2) * 3_600_000).toISOString(),
      seconds: 300 * (1 + (n % 7)),
      description: descriptions[n % descriptions.length]!,
    };
  }));
  const range = { start_date: '2026-03-01', end_date: '2026-03-31' };
  const page = async (body: Record<string, unknown>) => ctx.json('POST', '/api/app/report/entries', { ...range, ...body });

  // Walking every page reaches each entry exactly once.
  const walked: number[] = [];
  for (let n = 1; n <= 12; n++) {
    const res = await page({ page: n, page_size: 50 });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, total);
    assert.equal(res.body.pages, 12);
    assert.equal(res.body.page, n);
    walked.push(...res.body.entries.map((entry: any) => entry.id));
  }
  assert.equal(walked.length, total);
  assert.deepEqual([...walked].sort((a, b) => a - b), [...ids].sort((a, b) => a - b));

  const fields: Record<string, (entry: any) => string | number> = {
    date: (entry) => entry.start, duration: (entry) => entry.seconds, description: (entry) => entry.description,
  };
  const everything = async (sort: string, dir: string) => {
    const first = await page({ sort, dir, page_size: 500, page: 1 });
    const second = await page({ sort, dir, page_size: 500, page: 2 });
    return [...first.body.entries, ...second.body.entries];
  };
  for (const [sort, key] of Object.entries(fields)) {
    const ascending = await everything(sort, 'asc');
    assert.equal(ascending.length, total);
    let ties = 0;
    for (let i = 1; i < ascending.length; i++) {
      const [a, b] = [key(ascending[i - 1]), key(ascending[i])];
      assert.ok(a <= b, `${sort} asc out of order at ${i}`);
      if (a === b) {
        ties++;
        assert.ok(ascending[i - 1].id < ascending[i].id, `${sort} asc tie not broken by id at ${i}`);
      }
    }
    assert.ok(ties > 0, `${sort} has no ties to break`);
    const descending = await everything(sort, 'desc');
    assert.deepEqual(descending.map((entry) => entry.id), ascending.map((entry) => entry.id).reverse());
  }

  const byDefault = await page({});
  assert.equal(byDefault.body.page_size, 100);
  assert.equal(byDefault.body.entries.length, 100);
  assert.equal(byDefault.body.pages, 6);
  const largest = await page({ page_size: 500 });
  assert.equal(largest.body.entries.length, 500);
  assert.equal(largest.body.pages, 2);
  const tooLarge = await page({ page_size: 501 });
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.body, "'page_size' must be at most 500");
  assert.equal((await page({ page_size: 0 })).status, 400);

  // A page past the end returns the last page and says so.
  const last = await page({ page: 3, page_size: 250 });
  const beyond = await page({ page: 99, page_size: 250 });
  assert.equal(beyond.status, 200);
  assert.equal(beyond.body.page, 3);
  assert.equal(beyond.body.entries.length, 100);
  assert.deepEqual(beyond.body.entries, last.body.entries);
  assert.equal((await page({ page: 0 })).status, 400);
  const empty = await page({ start_date: '2025-01-01', end_date: '2025-01-31', page: 4 });
  assert.deepEqual([empty.body.total, empty.body.page, empty.body.pages, empty.body.entries], [0, 1, 1, []]);
});

/** Report requests covering every job shape the worker returns: JSON with headers, and CSV. */
function reportRequests(wid: number): Array<[string, Record<string, unknown>]> {
  const range = { start_date: '2026-10-05', end_date: '2026-10-11' };
  return [
    [`/reports/api/v3/workspace/${wid}/summary/time_entries`, { ...range, grouping: 'projects', sub_grouping: 'time_entries' }],
    [`/reports/api/v3/workspace/${wid}/search/time_entries`, { ...range, page_size: 2, order_dir: 'ASC' }],
    [`/reports/api/v3/workspace/${wid}/search/time_entries.csv`, range],
    ['/api/app/report', range],
    ['/api/app/report/entries', range],
    ['/api/app/report/detailed.csv', range],
    ['/api/app/report/summary.csv', { ...range, grouping: 'clients', sub_grouping: 'projects' }],
  ];
}

/** Status, headers and body of a response, without the headers that depend on the clock or socket. */
async function snapshot(response: Response) {
  const headers = [...response.headers].filter(([name]) => !['date', 'connection', 'keep-alive'].includes(name));
  return { status: response.status, headers, body: await response.text() };
}

async function statusAndBody(response: Response) {
  return { status: response.status, body: await response.text() };
}

/** Records every worker thread the process starts and how each one exits. */
function watchWorkers() {
  const started: Array<{ worker: Worker; exitCode: number | null }> = [];
  const listener = (worker: Worker) => {
    const record = { worker, exitCode: null as number | null };
    worker.on('exit', (code) => (record.exitCode = code));
    started.push(record);
  };
  process.on('worker', listener);
  return { started, stop: () => process.off('worker', listener) };
}

test('reports on a file-backed database are built in the worker and match the inline build', async (t) => {
  const ctx = await setup();
  await seed(ctx);
  const file = fileBackedCopy(ctx);
  // An in-memory database builds reports inline; a file-backed one hands them to the worker.
  assert.equal(ctx.db.location(), null);
  assert.equal(file.db.location(), file.path);
  const workers = watchWorkers();
  t.after(workers.stop);

  for (const [path, body] of reportRequests(ctx.wid)) {
    const inline = await snapshot(await ctx.request('POST', path, body));
    const worker = await snapshot(await file.request('POST', path, body));
    assert.equal(inline.status, 200, `${path}: ${inline.body}`);
    assert.deepEqual(worker, inline, path);
  }
  // One worker took every job and is still running.
  assert.equal(workers.started.length, 1);
  assert.equal(workers.started[0]!.exitCode, null);
});

test('an idle report worker lets the process exit once the server closes', async () => {
  // The child serves a file-backed app, runs one report, closes the server and returns without
  // process.exit. Before the fix the worker's message port held the process open indefinitely.
  const script = fileURLToPath(new URL('./fixtures/serveOneReport.ts', import.meta.url));
  const { code, signal, stdout } = await new Promise<{ code: number | null; signal: string | null; stdout: string }>((resolve) => {
    const child = execFile(process.execPath, [script], { timeout: 20_000 }, (_error, out) => {
      resolve({ code: child.exitCode, signal: child.signalCode, stdout: out });
    });
  });
  assert.equal(stdout, 'report 200\nclosed\n');
  assert.deepEqual({ code, signal }, { code: 0, signal: null });
});

test('a crashed report worker fails its pending jobs with 500 and the next report starts a new worker', async (t) => {
  const ctx = await setup();
  await seed(ctx);
  const file = fileBackedCopy(ctx);
  const workers = watchWorkers();
  t.after(workers.stop);
  const logged = t.mock.method(console, 'error', () => {});
  const [summary, , csv] = reportRequests(ctx.wid);

  // With the database file gone the worker throws while opening it, before it takes any job. The
  // app keeps its own open connection, so only report jobs are affected.
  const moved = `${file.path}.moved`;
  renameSync(file.path, moved);
  const failed = await Promise.all([summary!, csv!].map(([path, body]) => file.request('POST', path, body)));
  assert.deepEqual(await Promise.all(failed.map(statusAndBody)), [
    { status: 500, body: '"Internal Server Error"' },
    { status: 500, body: '"Internal Server Error"' },
  ]);
  assert.equal(logged.mock.callCount(), 2);
  for (const call of logged.mock.calls) assert.match(String(call.arguments[0]), /unable to open database file/);
  const crashed = [...workers.started];
  assert.ok(crashed.length >= 1);
  await Promise.all(crashed.map(({ worker, exitCode }) => (exitCode === null ? once(worker, 'exit') : null)));
  for (const record of crashed) assert.equal(record.exitCode, 1);
  // Requests that read on the main connection keep working while reports fail.
  assert.equal((await file.json('GET', '/api/v9/me/time_entries/current')).status, 200);

  renameSync(moved, file.path);
  for (const [path, body] of [summary!, csv!]) {
    const inline = await snapshot(await ctx.request('POST', path, body));
    assert.deepEqual(await snapshot(await file.request('POST', path, body)), inline, path);
  }
  const restarted = workers.started.slice(crashed.length);
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0]!.exitCode, null);
  assert.equal(logged.mock.callCount(), 2);
});
