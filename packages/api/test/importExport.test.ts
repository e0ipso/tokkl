import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type TestContext } from './helpers.ts';

const TOGGL_CSV = [
  'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (EUR)',
  'Me,me@example.com,ACME,Website,Design,"Homepage, hero",Yes,2026-09-01,09:00:00,2026-09-01,10:30:00,01:30:00,"design, web",150.00',
  'Me,me@example.com,,Internal,,Inbox zero,No,2026-09-01,23:30:00,2026-09-02,00:15:00,00:45:00,,',
  'Me,me@example.com,,,,"=cmd()",No,2026-09-02,08:00:00,,,00:10:00,,',
  'Me,me@example.com,,,,Broken row,No,not-a-date,08:00:00,,,00:10:00,,',
].join('\n');

test('imports a Toggl detailed CSV in the account timezone and skips duplicates on re-import', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const dry = await ctx.request('POST', '/api/app/import/toggl-csv?dry_run=true', TOGGL_CSV, { 'content-type': 'text/csv' });
  const dryBody = await dry.json() as any as any;
  assert.equal(dryBody.created, 3);
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-01&end_date=2026-09-03')).body.length, 0);

  const first = await (await ctx.request('POST', '/api/app/import/toggl-csv', TOGGL_CSV, { 'content-type': 'text/csv' })).json() as any;
  assert.equal(first.created, 3);
  assert.deepEqual(first.errors, [{ row: 5, message: 'Invalid start date or time' }]);
  assert.deepEqual(first.created_clients, ['ACME']);
  assert.deepEqual(first.created_projects.sort(), ['Internal', 'Website (ACME)']);

  const entries = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-01&end_date=2026-09-03&meta=true');
  const design = entries.body.find((e: any) => e.description === 'Homepage, hero');
  // 09:00 in Madrid (CEST, UTC+2) is 07:00 UTC.
  assert.equal(design.start, '2026-09-01T07:00:00+00:00');
  assert.equal(design.duration, 5400);
  assert.equal(design.billable, true);
  assert.equal(design.client_name, 'ACME');
  assert.equal(design.task_name, 'Design');
  assert.deepEqual(design.tags, ['design', 'web']);
  const midnight = entries.body.find((e: any) => e.description === 'Inbox zero');
  assert.equal(midnight.duration, 2700);

  const second = await (await ctx.request('POST', '/api/app/import/toggl-csv', TOGGL_CSV, { 'content-type': 'text/csv' })).json() as any;
  assert.equal(second.created, 0);
  assert.equal(second.skipped_duplicates, 3);
});

test('CSV export round-trips through the importer and neutralises formulas', async () => {
  const ctx = await setup({ timezone: 'America/New_York' });
  await ctx.request('POST', '/api/app/import/toggl-csv', TOGGL_CSV, { 'content-type': 'text/csv' });
  const exported = await ctx.request('GET', '/api/app/export.csv');
  assert.equal(exported.status, 200);
  const csv = await exported.text();
  assert.match(csv, /^User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags\r\n/);
  assert.match(csv, /'=cmd\(\)/);
  assert.match(csv, /"Homepage, hero"/);

  const other = await setup({ timezone: 'America/New_York' });
  const result = await (await other.request('POST', '/api/app/import/toggl-csv', csv, { 'content-type': 'text/csv' })).json() as any;
  assert.equal(result.created, 3);
  const before = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-08-30&end_date=2026-09-05')).body;
  const after = (await other.json('GET', '/api/v9/me/time_entries?start_date=2026-08-30&end_date=2026-09-05')).body;
  const shape = (list: any[]) => list.map((e) => [e.description, e.start, e.stop, e.billable, e.tags]).sort();
  assert.deepEqual(shape(after), shape(before));
});

test('JSON export contains every entity and never the password hash or token', async () => {
  const ctx = await setup();
  await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60, tags: ['a'] });
  const res = await ctx.request('GET', '/api/app/export.json');
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.format, 'timetrack-export');
  assert.equal(body.time_entries.length, 1);
  assert.equal(body.tags.length, 1);
  assert.ok(!text.includes(ctx.user.api_token));
  assert.ok(!text.includes('scrypt$'));
});

test('JSON export restores into a fresh account, including colors, rates, tasks and tags', async () => {
  const source = await setup({ timezone: 'Europe/Madrid' });
  const base = `/api/v9/workspaces/${source.wid}`;
  const client = await source.json('POST', `${base}/clients`, { name: 'ACME' });
  const project = await source.json('POST', `${base}/projects`, { name: 'Site', client_id: client.body.id, color: '#d92b2b', rate: 90, billable: true });
  const task = await source.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design' });
  await source.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 3600, task_id: task.body.id, tags: ['ux'], description: 'Wireframes' });
  await source.json('POST', `${base}/time_entries`, { start: '2026-10-02T08:00:00Z', duration: 60, description: 'Gone' }).then((r) =>
    source.request('DELETE', `${base}/time_entries/${r.body.id}`));
  const exported = await (await source.request('GET', '/api/app/export.json')).text();

  const target = await setup({ timezone: 'Europe/Madrid' });
  const dry = await (await target.request('POST', '/api/app/import/json?dry_run=true', exported)).json() as any;
  assert.equal(dry.time_entries, 1);
  assert.equal((await target.json('GET', '/api/v9/me/projects')).body.length, 0);

  const restored = await (await target.request('POST', '/api/app/import/json', exported)).json() as any;
  assert.deepEqual([restored.clients, restored.projects, restored.tasks, restored.tags, restored.time_entries], [1, 1, 1, 1, 1]);
  assert.deepEqual(restored.errors, []);
  const projects = (await target.json('GET', '/api/v9/me/projects')).body;
  assert.equal(projects[0].color, '#d92b2b');
  assert.equal(projects[0].rate, 90);
  assert.equal(projects[0].client_name, 'ACME');
  const entries = (await target.json('GET', '/api/v9/me/time_entries?start_date=2026-09-30&end_date=2026-10-05&meta=true')).body;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].task_name, 'Design');
  assert.deepEqual(entries[0].tags, ['ux']);
  assert.equal(entries[0].billable, true);

  const again = await (await target.request('POST', '/api/app/import/json', exported)).json() as any;
  assert.equal(again.time_entries, 0);
  assert.equal(again.skipped_duplicates, 1);

  const bad = await target.request('POST', '/api/app/import/json', '{"hello":1}');
  assert.equal(bad.status, 400);
});

test('CSV import rejects impossible dates instead of rolling them over', async () => {
  const ctx = await setup();
  const csv = [
    'Description,Start date,Start time,End date,End time',
    'Feb 31,2026-02-31,09:00:00,2026-02-31,10:00:00',
    'Month 13,13/25/2026,09:00:00,13/25/2026,10:00:00',
    'Fine,2026-02-28,09:00:00,2026-02-28,10:00:00',
  ].join('\n');
  const result = await (await ctx.request('POST', '/api/app/import/toggl-csv', csv, { 'content-type': 'text/csv' })).json() as any;
  assert.equal(result.created, 1);
  assert.deepEqual(result.errors.map((e: any) => e.row), [2, 3]);
});

/** Row counts of every table a JSON restore writes, so a preview can be checked to write nothing. */
function rowCounts(ctx: TestContext): Record<string, number> {
  return Object.fromEntries(['clients', 'projects', 'tasks', 'tags', 'time_entries'].map((table) =>
    [table, (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
}

async function restoreJson(ctx: TestContext, file: unknown, options: { dryRun?: boolean } = {}): Promise<any> {
  const res = await ctx.request('POST', `/api/app/import/json${options.dryRun ? '?dry_run=true' : ''}`, file);
  assert.equal(res.status, 200);
  return res.json();
}

/** A whole-second instant `hours` before now, as the API returns it. */
function hoursAgo(hours: number): string {
  return `${new Date(Math.floor(Date.now() / 1000) * 1000 - hours * 3_600_000).toISOString().slice(0, 19)}+00:00`;
}

test('JSON restore keeps project start dates and privacy, and a second restore leaves the project alone', async () => {
  const source = await setup();
  const base = `/api/v9/workspaces/${source.wid}`;
  await source.json('POST', `${base}/projects`, { name: 'Future public', start_date: '2031-05-20', is_private: false });
  await source.json('POST', `${base}/projects`, { name: 'Past private', start_date: '2026-03-01', is_private: true });
  const exported = await (await source.request('GET', '/api/app/export.json')).text();

  const target = await setup();
  const empty = rowCounts(target);
  const dry = await restoreJson(target, exported, { dryRun: true });
  assert.equal(dry.projects, 2);
  assert.deepEqual(rowCounts(target), empty);

  const restored = await restoreJson(target, exported);
  assert.equal(restored.projects, 2);
  assert.deepEqual(restored.errors, []);
  const shape = (list: any[]) => list.map((p) => [p.name, p.start_date, p.is_private, p.status]).sort();
  const projects = (await target.json('GET', '/api/v9/me/projects')).body;
  assert.deepEqual(shape(projects), [['Future public', '2031-05-20', false, 'upcoming'], ['Past private', '2026-03-01', true, 'active']]);

  // Edit the restored project here; restoring the file again must neither duplicate nor overwrite it.
  const future = projects.find((p: any) => p.name === 'Future public');
  await target.json('PUT', `/api/v9/workspaces/${target.wid}/projects/${future.id}`, { start_date: '2027-01-01', is_private: true });
  const again = await restoreJson(target, exported);
  assert.equal(again.projects, 0);
  assert.deepEqual(again.errors, []);
  const after = (await target.json('GET', '/api/v9/me/projects')).body;
  assert.deepEqual(shape(after), [['Future public', '2027-01-01', true, 'upcoming'], ['Past private', '2026-03-01', true, 'active']]);
});

test('JSON restore of a running entry waits until the timer running here is stopped, then imports it once', async () => {
  const source = await setup();
  const fileTimer = await source.json('POST', `/api/v9/workspaces/${source.wid}/time_entries`, { start: hoursAgo(2), duration: -1, description: 'File timer' });
  const exported = await (await source.request('GET', '/api/app/export.json')).text();

  const target = await setup();
  const here = await target.json('POST', `/api/v9/workspaces/${target.wid}/time_entries`, { start: hoursAgo(1), duration: -1, description: 'Here' });
  const conflict = [{
    entity: 'time_entry', id: fileTimer.body.id,
    message: 'Another timer is running here. Stop it and restore again to import this running entry',
  }];
  const before = rowCounts(target);
  for (const dryRun of [true, false]) {
    const result = await restoreJson(target, exported, { dryRun });
    assert.equal(result.time_entries, 0);
    assert.deepEqual(result.errors, conflict);
    assert.deepEqual(rowCounts(target), before);
    const current = (await target.json('GET', '/api/v9/me/time_entries/current')).body;
    assert.equal(current.id, here.body.id);
    assert.equal(current.stop, null);
  }

  await target.json('PATCH', `/api/v9/workspaces/${target.wid}/time_entries/${here.body.id}/stop`);
  const retry = await restoreJson(target, exported);
  assert.equal(retry.time_entries, 1);
  assert.deepEqual(retry.errors, []);
  const current = (await target.json('GET', '/api/v9/me/time_entries/current')).body;
  assert.equal(current.description, 'File timer');
  assert.equal(current.start, fileTimer.body.start);
  assert.equal(current.stop, null);

  const again = await restoreJson(target, exported);
  assert.equal(again.time_entries, 0);
  assert.equal(again.skipped_duplicates, 1);
  assert.deepEqual(again.errors, []);
  assert.equal(rowCounts(target).time_entries, 2);
});

test('JSON restore reports references to records that were not imported and skips their dependents', async () => {
  const at = (hour: number) => ({ start: `2026-10-01T${hour}:00:00Z`, stop: `2026-10-01T${hour}:30:00Z` });
  const file = {
    format: 'timetrack-export',
    clients: [{ id: 1, name: 'Known' }],
    projects: [
      { id: 10, name: 'Orphan', client_id: 99 },
      { id: 11, name: 'No client', client_id: null },
    ],
    tasks: [
      { id: 20, name: 'Under orphan', project_id: 10 },
      { id: 21, name: 'Build', project_id: 11 },
    ],
    tags: [{ id: 30, name: 'ok' }],
    time_entries: [
      { id: 40, ...at(10), description: 'Unknown project', project_id: 98 },
      { id: 41, ...at(11), description: 'Unknown task', project_id: 11, task_id: 97 },
      { id: 42, ...at(12), description: 'Unknown tag', tag_ids: [30, 77] },
      { id: 43, ...at(13), description: 'Failed project', project_id: 10 },
      { id: 44, ...at(14), description: 'Nulls', project_id: null, task_id: null, tag_ids: null },
      { id: 45, ...at(15), description: 'Linked', project_id: 11, task_id: 21, tag_ids: [30] },
    ],
  };
  const errors = [
    { entity: 'project', id: 10, message: 'Its client 99 was not imported' },
    { entity: 'task', id: 20, message: 'Its project 10 was not imported' },
    { entity: 'time_entry', id: 40, message: 'Its project 98 was not imported' },
    { entity: 'time_entry', id: 41, message: 'Its task 97 was not imported' },
    { entity: 'time_entry', id: 42, message: 'Its tag 77 was not imported' },
    { entity: 'time_entry', id: 43, message: 'Its project 10 was not imported' },
  ];

  const ctx = await setup();
  const empty = rowCounts(ctx);
  const dry = await restoreJson(ctx, file, { dryRun: true });
  assert.deepEqual(dry.errors, errors);
  assert.deepEqual(rowCounts(ctx), empty);

  const result = await restoreJson(ctx, file);
  assert.deepEqual(result.errors, errors);
  assert.deepEqual([result.clients, result.projects, result.tasks, result.tags, result.time_entries], [1, 1, 1, 1, 2]);
  assert.deepEqual(rowCounts(ctx), { clients: 1, projects: 1, tasks: 1, tags: 1, time_entries: 2 });
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-30&end_date=2026-10-02&meta=true')).body;
  const shape = entries.map((e: any) => [e.description, e.project_name, e.task_name, e.tags]).sort();
  assert.deepEqual(shape, [['Linked', 'No client', 'Build', ['ok']], ['Nulls', null, null, []]]);
});

test('a failed task import leaves archived projects archived', async () => {
  const ctx = await setup();
  const legacy = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Legacy' });
  await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/projects/${legacy.body.id}`, { active: false });
  const file = {
    format: 'timetrack-export',
    projects: [
      { id: 1, name: 'Old', active: false },
      { id: 2, name: 'Legacy', active: false },
    ],
    tasks: [
      { id: 10, name: '', project_id: 1 },
      { id: 11, name: 'Kept', project_id: 1 },
      { id: 12, name: 'x'.repeat(256), project_id: 2 },
    ],
  };

  const result = await restoreJson(ctx, file);
  assert.equal(result.projects, 1);
  assert.equal(result.tasks, 1);
  assert.deepEqual(result.errors, [
    { entity: 'task', id: 10, message: "Task name can't be blank" },
    { entity: 'task', id: 12, message: 'Task name must be at most 255 characters' },
  ]);
  const projects = (await ctx.json('GET', '/api/v9/me/projects?include_archived=true')).body;
  assert.deepEqual(projects.map((p: any) => [p.name, p.active]).sort(), [['Legacy', false], ['Old', false]]);
});

test('JSON restore rejects zone-free, impossible and non-string entry times per entry', async () => {
  const startError = 'Invalid start: expected an RFC 3339 timestamp';
  const stopError = 'Invalid stop: expected an RFC 3339 timestamp';
  const file = {
    format: 'timetrack-export',
    time_entries: [
      { id: 1, start: '2026-10-01T08:00:00', stop: '2026-10-01T09:00:00Z' },
      { id: 2, start: '2026-10-01T08:00:00Z', stop: '2026-10-01T09:00:00' },
      { id: 3, start: '2026-02-30T08:00:00Z', stop: '2026-02-30T09:00:00Z' },
      { id: 4, start: 1790000000, stop: '2026-10-01T09:00:00Z' },
      { id: 5, start: '2026-10-01T08:00:00Z', stop: 1790003600 },
      { id: 6, start: '2026-10-01T08:00:00Z', stop: '' },
      { id: 7, start: '2026-10-01T10:00:00Z', stop: '2026-10-01T11:00:00Z', description: 'Valid' },
    ],
  };
  const errors = [
    { entity: 'time_entry', id: 1, message: startError },
    { entity: 'time_entry', id: 2, message: stopError },
    { entity: 'time_entry', id: 3, message: startError },
    { entity: 'time_entry', id: 4, message: startError },
    { entity: 'time_entry', id: 5, message: stopError },
    { entity: 'time_entry', id: 6, message: stopError },
  ];
  const ctx = await setup();
  for (const dryRun of [true, false]) {
    const result = await restoreJson(ctx, file, { dryRun });
    assert.equal(result.time_entries, 1);
    assert.deepEqual(result.errors, errors);
  }
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-02-01&end_date=2026-10-31')).body;
  assert.deepEqual(entries.map((e: any) => [e.description, e.start, e.stop]), [['Valid', '2026-10-01T10:00:00+00:00', '2026-10-01T11:00:00+00:00']]);

  // A null or missing stop is a running entry, not an error.
  for (const running of [{ stop: null }, {}]) {
    const other = await setup();
    const result = await restoreJson(other, { format: 'timetrack-export', time_entries: [{ id: 1, start: hoursAgo(1), description: 'Open', ...running }] });
    assert.equal(result.time_entries, 1);
    assert.deepEqual(result.errors, []);
    const current = (await other.json('GET', '/api/v9/me/time_entries/current')).body;
    assert.equal(current.description, 'Open');
    assert.equal(current.stop, null);
  }

  // A file written by the exporter still restores completely, running entry included.
  const source = await setup();
  await source.json('POST', `/api/v9/workspaces/${source.wid}/time_entries`, { start: hoursAgo(3), duration: 600, description: 'Done' });
  await source.json('POST', `/api/v9/workspaces/${source.wid}/time_entries`, { start: hoursAgo(1), duration: -1, description: 'Running' });
  const exported = await (await source.request('GET', '/api/app/export.json')).text();
  const target = await setup();
  const restored = await restoreJson(target, exported);
  assert.equal(restored.time_entries, 2);
  assert.deepEqual(restored.errors, []);
  assert.equal((await target.json('GET', '/api/v9/me/time_entries/current')).body.description, 'Running');
});

test('JSON restore refuses a project rate above the cap and still imports the rest', async () => {
  const ctx = await setup();
  const result = await restoreJson(ctx, {
    format: 'timetrack-export',
    projects: [
      { id: 1, name: 'Overpriced', rate: 1_000_000_001 },
      { id: 2, name: 'At the cap', rate: 1_000_000_000 },
    ],
    time_entries: [
      { id: 3, start: '2026-10-01T08:00:00Z', stop: '2026-10-01T09:00:00Z', description: 'On overpriced', project_id: 1 },
      { id: 4, start: '2026-10-01T10:00:00Z', stop: '2026-10-01T11:00:00Z', description: 'On capped', project_id: 2 },
    ],
  });
  assert.deepEqual(result.errors, [
    { entity: 'project', id: 1, message: 'Invalid rate: expected at most 1000000000' },
    { entity: 'time_entry', id: 3, message: 'Its project 1 was not imported' },
  ]);
  assert.equal(result.projects, 1);
  assert.equal(result.time_entries, 1);
  const projects = (await ctx.json('GET', '/api/v9/me/projects')).body;
  assert.deepEqual(projects.map((p: any) => [p.name, p.rate]), [['At the cap', 1_000_000_000]]);
});
