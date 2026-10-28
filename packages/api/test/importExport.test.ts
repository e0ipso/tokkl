import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, setup, type TestContext } from './helpers.ts';

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

// Live writes snap to the time resolution; imported history keeps the times in the file.
test('CSV import and JSON restore keep exact times, and a second import adds nothing', async () => {
  const ctx = await setup();
  const csv = [
    'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (EUR)',
    'Me,me@example.com,,,,From CSV,No,2026-09-01,09:02:31,2026-09-01,09:13:07,00:10:36,,',
  ].join('\n');
  const file = {
    format: 'tokkl-export',
    time_entries: [{ id: 1, start: '2026-09-02T08:00:07Z', stop: '2026-09-02T08:31:45Z', description: 'From JSON' }],
  };
  const importCsv = async () => (await ctx.request('POST', '/api/app/import/toggl-csv', csv, { 'content-type': 'text/csv' })).json() as any;

  assert.equal((await importCsv()).created, 1);
  assert.equal((await restoreJson(ctx, file)).time_entries, 1);
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-01&end_date=2026-09-03')).body;
  const times = (description: string) => {
    const entry = entries.find((e: any) => e.description === description);
    return [entry.start, entry.stop, entry.duration];
  };
  assert.deepEqual(times('From CSV'), ['2026-09-01T09:02:31+00:00', '2026-09-01T09:13:07+00:00', 636]);
  assert.deepEqual(times('From JSON'), ['2026-09-02T08:00:07+00:00', '2026-09-02T08:31:45+00:00', 1898]);

  const csvAgain = await importCsv();
  assert.deepEqual([csvAgain.created, csvAgain.skipped_duplicates], [0, 1]);
  const jsonAgain = await restoreJson(ctx, file);
  assert.deepEqual([jsonAgain.time_entries, jsonAgain.skipped_duplicates], [0, 1]);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n, 2);
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

test('a no-time entry survives CSV export and import into another timezone, once', async () => {
  const source = await setup({ timezone: 'Europe/Madrid' });
  const created = await source.json('POST', `/api/v9/workspaces/${source.wid}/time_entries`, {
    all_day: true, start_date: '2026-09-10', duration: 5400, description: 'Planning',
  });
  assert.equal(created.status, 200);
  const csv = await (await source.request('GET', '/api/app/export.csv')).text();

  const target = await addUser(source, { email: 'ny@example.com', role: 'user', timezone: 'America/New_York' });
  const importCsv = async () => (await target.request('POST', '/api/app/import/toggl-csv', csv, { 'content-type': 'text/csv' })).json() as any;
  const first = await importCsv();
  assert.deepEqual([first.created, first.skipped_duplicates, first.errors], [1, 0, []]);

  const [entry] = (await target.json('GET', '/api/v9/me/time_entries?start_date=2026-09-09&end_date=2026-09-12')).body;
  assert.equal(entry.all_day, true);
  assert.equal(entry.description, 'Planning');
  assert.equal(entry.start, '2026-09-10T04:00:00+00:00');
  assert.equal(entry.duration, 5400);

  const again = await importCsv();
  assert.deepEqual([again.created, again.skipped_duplicates], [0, 1]);
});

test('CSV import refuses blank-time rows with no duration or one outside 0 to 24 hours, and imports the rest', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const csv = [
    'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags',
    'Me,me@example.com,,,,Zero,No,2026-09-10,,2026-09-10,,0:00:00,',
    'Me,me@example.com,,,,Too long,No,2026-09-10,,2026-09-11,,25:00:00,',
    'Me,me@example.com,,,,Bad day,No,not-a-date,,,,1:00:00,',
    'Me,me@example.com,,,,Unreadable,No,2026-09-10,,,,soon,',
    'Me,me@example.com,,,,Fine,No,2026-09-10,,2026-09-10,,1:00:00,',
  ].join('\n');
  const send = async (query: string) =>
    (await ctx.request('POST', `/api/app/import/toggl-csv${query}`, csv, { 'content-type': 'text/csv' })).json() as any;

  const dry = await send('?dry_run=true');
  assert.deepEqual([dry.created, dry.errors.map((e: any) => e.row)], [1, [2, 3, 4, 5]]);
  const result = await send('');
  assert.deepEqual([result.created, result.errors.map((e: any) => e.row)], [1, [2, 3, 4, 5]]);
  assert.equal(result.errors[2].message, 'Invalid start date');
  assert.equal(result.errors[3].message, 'Invalid duration');
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-09&end_date=2026-09-12')).body;
  assert.deepEqual(entries.map((e: any) => [e.description, e.all_day]), [['Fine', true]]);
});

test('a no-time entry restores from JSON onto the same date at midnight in the restoring timezone, once', async () => {
  const source = await setup({ timezone: 'Europe/Madrid' });
  await source.json('POST', `/api/v9/workspaces/${source.wid}/time_entries`, {
    all_day: true, start_date: '2026-09-10', duration: 7200, description: 'Review',
  });
  const exported = JSON.parse(await (await source.request('GET', '/api/app/export.json')).text());
  assert.equal(exported.time_entries[0].all_day, true);

  const target = await addUser(source, { email: 'ny@example.com', role: 'user', timezone: 'America/New_York' });
  const dry = await restoreJson(target, exported, { dryRun: true });
  assert.equal(dry.time_entries, 1);
  const restored = await restoreJson(target, exported);
  assert.deepEqual([restored.time_entries, restored.errors], [1, []]);
  const [entry] = (await target.json('GET', '/api/v9/me/time_entries?start_date=2026-09-09&end_date=2026-09-12')).body;
  assert.equal(entry.all_day, true);
  assert.equal(entry.start, '2026-09-10T04:00:00+00:00');
  assert.equal(entry.duration, 7200);

  const again = await restoreJson(target, exported);
  assert.deepEqual([again.time_entries, again.skipped_duplicates], [0, 1]);

  // Backups written before the flag existed, and any value but true, restore as timed entries.
  const timed = { format: 'tokkl-export', time_entries: [{ id: 9, start: '2026-09-11T08:00:00Z', stop: '2026-09-11T09:00:00Z', all_day: 'true' }] };
  assert.equal((await restoreJson(target, timed)).time_entries, 1);
  const found = (await target.json('GET', '/api/v9/me/time_entries?start_date=2026-09-11&end_date=2026-09-12')).body;
  assert.deepEqual(found.map((e: any) => [e.start, e.all_day]), [['2026-09-11T08:00:00+00:00', false]]);
});

test('JSON export contains every entity and never the password hash or token', async () => {
  const ctx = await setup();
  await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 600, tags: ['a'] });
  const res = await ctx.request('GET', '/api/app/export.json');
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.format, 'tokkl-export');
  assert.equal(body.time_entries.length, 1);
  assert.equal(body.tags.length, 1);
  assert.ok(!text.includes(ctx.user.api_token));
  assert.ok(!text.includes('scrypt$'));
});

test('JSON export includes the four Pomodoro lengths without retired toggle keys', async () => {
  const ctx = await setup();
  const response = await ctx.json('GET', '/api/app/export.json');
  assert.equal(response.status, 200);
  const preferences = response.body.preferences;
  assert.deepEqual(Object.fromEntries(Object.entries(preferences).filter(([key]) => key.startsWith('pomodoro_'))), {
    pomodoro_focus_interval_in_minutes: 25,
    pomodoro_break_interval_in_minutes: 5,
    pomodoro_long_break_interval_in_minutes: 15,
    pomodoro_long_break_every: 4,
  });
});

test('JSON restore accepts older exports containing retired Pomodoro toggle keys', async () => {
  const ctx = await setup();
  const file = {
    format: 'tokkl-export',
    version: 1,
    preferences: {
      pomodoro_enabled: true,
      pomodoro_stop_timer_at_end: false,
      pomodoro_focus_interval_in_minutes: 40,
      pomodoro_break_interval_in_minutes: 10,
      pomodoro_long_break_interval_in_minutes: 20,
      pomodoro_long_break_every: 3,
    },
    projects: [{ id: 1, name: 'Legacy session' }],
    time_entries: [{ id: 2, project_id: 1, start: '2026-10-01T09:00:00Z', stop: '2026-10-01T10:00:00Z', description: 'Before sessions' }],
  };
  const preferencesBefore = (await ctx.json('GET', '/api/v9/me/preferences')).body;
  for (const dryRun of [true, false]) {
    const result = await restoreJson(ctx, file, { dryRun });
    assert.equal(result.projects, 1);
    assert.equal(result.time_entries, 1);
    assert.deepEqual(result.errors, []);
  }
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02&meta=true')).body;
  assert.deepEqual(entries.map((entry: any) => [entry.description, entry.project_name]), [['Before sessions', 'Legacy session']]);
  assert.deepEqual((await ctx.json('GET', '/api/v9/me/preferences')).body, preferencesBefore);
});

test('JSON export restores into a fresh account, including colors, rates, tasks and tags', async () => {
  const source = await setup({ timezone: 'Europe/Madrid' });
  const base = `/api/v9/workspaces/${source.wid}`;
  const client = await source.json('POST', `${base}/clients`, { name: 'ACME' });
  const project = await source.json('POST', `${base}/projects`, { name: 'Site', client_id: client.body.id, color: '#d92b2b', rate: 90, billable: true });
  const task = await source.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design' });
  await source.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 3600, task_id: task.body.id, tags: ['ux'], description: 'Wireframes' });
  await source.json('POST', `${base}/time_entries`, { start: '2026-10-02T08:00:00Z', duration: 600, description: 'Gone' }).then((r) =>
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

test('CSV import takes a duration up to 999 hours and refuses longer ones and unknown units', async () => {
  const ctx = await setup();
  const csv = [
    'Description,Start date,Start time,End date,End time,Duration',
    'At the limit,2026-03-02,09:00:00,,,999:00:00',
    'One second over,2026-03-02,10:00:00,,,999:00:01',
    'Over in hours,2026-03-02,11:00:00,,,1000h',
    'Prototype key,2026-03-02,12:00:00,,,1 constructor',
  ].join('\n');
  const result = await (await ctx.request('POST', '/api/app/import/toggl-csv', csv, { 'content-type': 'text/csv' })).json() as any;
  assert.equal(result.created, 1);
  assert.deepEqual(result.errors, [3, 4, 5].map((row) => ({ row, message: 'Invalid end time or duration' })));
  const entries = (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-03-01&end_date=2026-04-15')).body;
  assert.deepEqual(entries.map((e: any) => [e.description, e.duration]), [['At the limit', 999 * 3600]]);
});

test('CSV import keeps a user apart from one whose User cell spells out a name and email', async () => {
  const ctx = await setup();
  const csv = [
    'User,Email,Description,Start date,Start time,End date,End time',
    'Alice,a@example.com,From Alice,2026-09-01,09:00:00,2026-09-01,10:00:00',
    '"Alice <a@example.com>",,From the other Alice,2026-09-01,11:00:00,2026-09-01,12:00:00',
  ].join('\n');
  const post = (query: string) => ctx.request('POST', `/api/app/import/toggl-csv${query}`, csv, { 'content-type': 'text/csv' });

  const preview = await (await post('?dry_run=true')).json() as any;
  assert.deepEqual(preview.users.map(({ user, email, rows }: any) => ({ user, email, rows })), [
    { user: 'Alice', email: 'a@example.com', rows: 1 },
    { user: 'Alice <a@example.com>', email: '', rows: 1 },
  ]);
  assert.notEqual(preview.users[0].key, preview.users[1].key);
  assert.equal((await post('')).status, 400, 'two users need a selection');

  const [alice, other] = preview.users;
  const imported = await (await post(`?user=${encodeURIComponent(alice.key)}`)).json() as any;
  assert.equal(imported.created, 1);
  assert.deepEqual(imported.skipped, [{ rows: 1, reason: 'Rows from Alice <a@example.com> were not selected' }]);
  const entries = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-01&end_date=2026-09-02');
  assert.deepEqual(entries.body.map((entry: any) => entry.description), ['From Alice']);

  const rest = await (await post(`?user=${encodeURIComponent(other.key)}`)).json() as any;
  assert.equal(rest.created, 1);
  assert.deepEqual(rest.skipped, [{ rows: 1, reason: 'Rows from Alice <a@example.com> were not selected' }]);
});

test('a two-user CSV previews both users, needs a selection and imports only the selected rows, once', async () => {
  const ctx = await setup();
  const csv = [
    'User,Email,Project,Description,Start date,Start time,End date,End time',
    'Ann,ann@example.com,Ann project,Ann first,2026-09-01,09:00:00,2026-09-01,10:00:00',
    'Bob,bob@example.com,Bob project,Bob only,2026-09-01,10:00:00,2026-09-01,11:00:00',
    'Ann,ann@example.com,Ann project,Ann second,2026-09-02,09:00:00,2026-09-02,10:00:00',
  ].join('\n');
  const post = (query: string) => ctx.request('POST', `/api/app/import/toggl-csv${query}`, csv, { 'content-type': 'text/csv' });
  const empty = rowCounts(ctx);

  const preview = await (await post('?dry_run=true')).json() as any;
  assert.deepEqual(preview.users.map(({ user, email, rows }: any) => ({ user, email, rows })), [
    { user: 'Ann', email: 'ann@example.com', rows: 2 },
    { user: 'Bob', email: 'bob@example.com', rows: 1 },
  ]);
  assert.deepEqual(rowCounts(ctx), empty, 'the preview writes nothing');

  const unselected = await post('');
  assert.equal(unselected.status, 400);
  assert.match(await unselected.json() as string, /2 Toggl users/);
  assert.deepEqual(rowCounts(ctx), empty, 'a refused import writes nothing');

  const ann = preview.users[0].key as string;
  const first = await (await post(`?user=${encodeURIComponent(ann)}`)).json() as any;
  assert.equal(first.created, 2);
  assert.deepEqual(first.skipped, [{ rows: 1, reason: 'Rows from Bob <bob@example.com> were not selected' }]);
  assert.deepEqual(first.created_projects, ['Ann project'], "the skipped user's project is not created");
  const entries = async () => (await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-09-01&end_date=2026-09-03')).body
    .map((entry: any) => entry.description).sort();
  assert.deepEqual(await entries(), ['Ann first', 'Ann second']);

  const again = await (await post(`?user=${encodeURIComponent(ann)}`)).json() as any;
  assert.equal(again.created, 0);
  assert.equal(again.skipped_duplicates, 2);
  assert.deepEqual(again.skipped, first.skipped);
  assert.deepEqual(await entries(), ['Ann first', 'Ann second']);
  assert.equal(rowCounts(ctx).projects, empty.projects! + 1);
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
    format: 'tokkl-export',
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
    format: 'tokkl-export',
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
    format: 'tokkl-export',
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
    const result = await restoreJson(other, { format: 'tokkl-export', time_entries: [{ id: 1, start: hoursAgo(1), description: 'Open', ...running }] });
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
    format: 'tokkl-export',
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

test('JSON restore accepts an export written before the rename to Tokkl', async () => {
  const ctx = await setup();
  const file = {
    format: 'timetrack-export',
    version: 1,
    projects: [{ id: 1, name: 'Old export', color: '#0b83d9' }],
    time_entries: [{ id: 2, start: '2026-10-01T09:00:00Z', stop: '2026-10-01T10:00:00Z', description: 'Before', project_id: 1 }],
  };
  const result = await restoreJson(ctx, file);
  assert.equal(result.projects, 1);
  assert.equal(result.time_entries, 1);
  assert.deepEqual(result.errors, []);

  const unknown = await ctx.request('POST', '/api/app/import/json', { ...file, format: 'something-else' });
  assert.equal(unknown.status, 400);
  assert.equal(await unknown.json(), 'This is not a Tokkl JSON export');
});

test('imports into a default workspace the caller is not a member of are refused and write nothing', async () => {
  const owner = await setup();
  const bob = await addUser(owner, { email: 'bob@example.com', role: 'user' });
  // Data written before membership checks, or a membership that later ended, can leave this behind.
  owner.db.prepare('UPDATE users SET default_workspace_id = ? WHERE id = ?').run(owner.wid, bob.user.id);
  const file = {
    format: 'tokkl-export',
    version: 1,
    clients: [{ id: 1, name: 'Intruder client' }],
    projects: [{ id: 2, name: 'Intruder project', client_id: 1 }],
    tags: [{ id: 3, name: 'intruder' }],
    time_entries: [{ id: 4, start: '2026-10-01T09:00:00Z', stop: '2026-10-01T10:00:00Z', description: 'Intruder', project_id: 2, tag_ids: [3] }],
  };
  const before = rowCounts(owner);

  for (const query of ['?dry_run=true', '']) {
    const json = await bob.request('POST', `/api/app/import/json${query}`, file);
    assert.equal(json.status, 403, `JSON import${query}`);
    assert.equal(await json.json(), 'User does not have access to this resource.');
    const csv = await bob.request('POST', `/api/app/import/toggl-csv${query}`, TOGGL_CSV, { 'content-type': 'text/csv' });
    assert.equal(csv.status, 403, `CSV import${query}`);
    assert.equal(await csv.json(), 'User does not have access to this resource.');
  }
  assert.deepEqual(rowCounts(owner), before);
});
