import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type TestContext } from './helpers.ts';

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
