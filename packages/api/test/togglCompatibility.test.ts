import { corruptRecord } from './fixtures/physical.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, independentReportServer, setup, type TestContext } from './helpers.ts';

// Contract references checked on 2026-10-17:
// https://engineering.toggl.com/docs/track/api/clients/
// https://engineering.toggl.com/docs/track/api/me/
// https://engineering.toggl.com/docs/track/api/tasks/
// https://engineering.toggl.com/docs/track/api/time_entries/
// https://engineering.toggl.com/docs/track/reports/detailed_reports/
// These run against local HTTP servers and never need a Toggl account or network access.

test('workspace clients default to active; both and archived remain explicit choices', async () => {
  const ctx = (await setup());
  const url = `/api/v9/workspaces/${ctx.wid}/clients`;
  const active = (await ctx.json('POST', url, { name: 'Active' })).body;
  const archived = (await ctx.json('POST', url, { name: 'Archived' })).body;
  await ctx.json('POST', `${url}/${archived.id}/archive`);
  assert.deepEqual((await ctx.json('GET', url)).body.map((c: any) => c.id), [active.id]);
  assert.equal((await ctx.json('GET', `${url}?status=both`)).body.length, 2);
  assert.deepEqual((await ctx.json('GET', `${url}?status=archived`)).body.map((c: any) => c.id), [archived.id]);
  const invalid = await ctx.json('GET', `${url}?status=invalid`);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body, 'Client status is invalid');
});

test('restoring a client honors selected projects and restore_all_projects', async () => {
  const ctx = (await setup());
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = (await ctx.json('POST', `${base}/clients`, { name: 'Client' })).body;
  const projects = [];
  for (const name of ['First', 'Second']) {
    projects.push((await ctx.json('POST', `${base}/projects`, { name, client_id: client.id })).body);
  }
  const url = `${base}/clients/${client.id}`;
  await ctx.json('POST', `${url}/archive`);
  const selected = await ctx.json('POST', `${url}/restore`, { projects: [projects[0].id] });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.archived, false);
  assert.equal((await ctx.json('GET', `${base}/projects/${projects[0].id}`)).body.active, true);
  assert.equal((await ctx.json('GET', `${base}/projects/${projects[1].id}`)).body.active, false);
  await ctx.json('POST', `${url}/archive`);
  await ctx.json('POST', `${url}/restore`, { restore_all_projects: false });
  assert.equal((await ctx.json('GET', `${base}/projects/${projects[0].id}`)).body.active, false);
  await ctx.json('POST', `${url}/restore`, { restore_all_projects: true });
  assert.equal((await ctx.json('GET', `${base}/projects/${projects[1].id}`)).body.active, true);
  await ctx.json('POST', `${url}/archive`);
  await ctx.json('POST', `${url}/restore`);
  assert.equal((await ctx.json('GET', `${base}/projects/${projects[0].id}`)).body.active, false);
});

test('client restore refuses foreign project selections without changing the client', async () => {
  const ctx = (await setup());
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = (await ctx.json('POST', `${base}/clients`, { name: 'Client' })).body;
  const foreign = (await addUser(ctx, { email: 'other@example.com', role: 'user' }));
  const project = (await foreign.json('POST', `/api/v9/workspaces/${foreign.wid}/projects`, { name: 'Private' })).body;
  await ctx.json('POST', `${base}/clients/${client.id}/archive`);
  const restored = await ctx.json('POST', `${base}/clients/${client.id}/restore`, { projects: [project.id] });
  assert.equal(restored.status, 400);
  assert.equal((await ctx.json('GET', `${base}/clients/${client.id}`)).body.archived, true);
});

test('catalog since filters apply before task offset pagination', async () => {
  const ctx = (await setup());
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = (await ctx.json('POST', `${base}/projects`, { name: 'Project' })).body;
  for (const name of ['Old', 'Recent A', 'Recent B']) {
    await ctx.json('POST', `${base}/clients`, { name });
    await ctx.json('POST', `${base}/tags`, { name });
    await ctx.json('POST', `${base}/projects/${project.id}/tasks`, { name });
  }
  for (const table of ['clients', 'tags', 'tasks'] as const) {
    await corruptRecord(ctx.db,table,{updated_at:'2020-01-01T00:00:00.000Z'},{name:'Old'});
  }
  await corruptRecord(ctx.db,'projects',{updated_at:'2020-01-01T00:00:00.000Z'},{id:project.id});
  const since = Date.parse('2026-01-01T00:00:00Z') / 1000;
  for (const area of ['clients', 'tags']) {
    assert.deepEqual((await ctx.json('GET', `/api/v9/me/${area}?since=${since}`)).body.map((r: any) => r.name), ['Recent A', 'Recent B']);
  }
  assert.deepEqual((await ctx.json('GET', `/api/v9/me/projects?since=${since}`)).body, []);
  const tasks = await ctx.json('GET', `/api/v9/me/tasks?since=${since}&offset=1&per_page=1`);
  assert.deepEqual(tasks.body.map((r: any) => r.name), ['Recent B']);
  assert.equal((await ctx.json('GET', `${base}/tasks?since=${since}`)).body.total_count, 2);
  await corruptRecord(ctx.db,'workspaces',{updated_at:'2020-01-01T00:00:00.000Z'},{id:ctx.wid});
  assert.deepEqual((await ctx.json('GET', `/api/v9/me/workspaces?since=${since}`)).body, []);
  assert.equal((await ctx.json('GET', `${base}/projects?since=99999999999999999`)).status, 400);
  for (const area of ['clients', 'tags', 'projects', 'tasks', 'workspaces']) {
    assert.equal((await ctx.json('GET', `/api/v9/me/${area}?since=invalid`)).status, 400);
  }
});

test('workspace tasks honor requested sorting before pagination', async () => {
  const ctx = (await setup());
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = (await ctx.json('POST', `${base}/projects`, { name: 'Project' })).body;
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    const task = (await ctx.json('POST', `${base}/projects/${project.id}/tasks`, { name })).body;
    await corruptRecord(ctx.db,'tasks',{created_at:`2026-10-0${4 - task.id}T00:00:00.000Z`},{id:task.id});
  }
  const names = await ctx.json('GET', `${base}/tasks?sort_order=DESC&per_page=1&page=2`);
  assert.equal(names.body.sort_order, 'DESC');
  assert.deepEqual(names.body.data.map((r: any) => r.name), ['Bravo']);
  const dates = await ctx.json('GET', `${base}/tasks?sort_field=created_at&sort_order=ASC&per_page=1`);
  assert.equal(dates.body.sort_field, 'created_at');
  assert.deepEqual(dates.body.data.map((r: any) => r.name), ['Charlie']);
  for (const query of ['sort_field=invalid', 'sort_order=invalid']) {
    assert.equal((await ctx.json('GET', `${base}/tasks?${query}`)).status, 400);
  }
});

test('time entry start_date overrides the date in start before duration is applied', async () => {
  const ctx = (await setup());
  const result = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-01T08:00:00+02:00', start_date: '2026-10-02', duration: 600,
    workspace_id: ctx.wid, created_with: 'compatibility test',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.start, '2026-10-02T06:00:00+00:00');
  assert.equal(result.body.stop, '2026-10-02T06:10:00+00:00');
  const invalid = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-01T08:00:00Z', start_date: '2026-02-30', duration: 600,
  });
  assert.equal(invalid.status, 400);
  const updated = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${result.body.id}`, {
    start_date: '2026-10-03', duration: 600,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.start, '2026-10-03T06:00:00+00:00');
});

test('inconsistent stop and duration are rejected on create and update without side effects', async () => {
  const ctx = (await setup());
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const running = (await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: -1 })).body;
  const inconsistent = { start: '2026-10-01T09:00:00Z', stop: '2026-10-01T10:00:00Z', duration: 600, tags: ['Do not create'] };
  assert.equal((await ctx.json('POST', url, inconsistent)).status, 400);
  assert.equal((await ctx.json('PUT', `${url}/${running.id}`, inconsistent)).status, 400);
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body.id, running.id);
  assert.deepEqual((await ctx.json('GET', '/api/v9/me/tags')).body, []);
  assert.equal((await ctx.json('POST', url, { start: inconsistent.start, stop: inconsistent.stop, duration: 3600 })).status, 200);
});

async function reportFixture(ctx: TestContext) {
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  for (const [i, duration] of [300, 600, 900].entries()) {
    await ctx.json('POST', url, { start: `2026-10-0${i + 1}T08:00:00Z`, duration, description: String(duration) });
  }
  return { start_date: '2026-10-01', end_date: '2026-12-31' };
}

test('report user_ids filter cannot return the caller data for another user', async () => {
  const ctx = (await setup());
  const range = (await reportFixture(ctx));
  const other = (await addUser(ctx, { email: 'other@example.com', role: 'user' }));
  for (const server of [ctx, (await independentReportServer(ctx))]) {
    const base = `/reports/api/v3/workspace/${ctx.wid}`;
    for (const userIds of [[other.user.id], [null]]) {
      const body = { ...range, user_ids: userIds };
      assert.deepEqual((await server.json('POST', `${base}/search/time_entries`, body)).body, []);
      assert.equal((await server.json('POST', `${base}/search/time_entries/totals`, body)).body.seconds, 0);
      assert.deepEqual((await server.json('POST', `${base}/summary/time_entries`, body)).body.groups, []);
      assert.deepEqual((await server.json('POST', `${base}/weekly/time_entries`, body)).body, []);
      const csv = await server.request('POST', `${base}/search/time_entries.csv`, body);
      assert.equal((await csv.text()).trim().split('\n').length, 1);
    }
    assert.equal((await server.json('POST', `${base}/search/time_entries`, { ...range, user_ids: [ctx.user.id] })).body.length, 3);
  }
});

test('report duration filters apply to stored durations before report rounding', async () => {
  const ctx = (await setup());
  const range = (await reportFixture(ctx));
  const base = `/reports/api/v3/workspace/${ctx.wid}`;
  const body = { ...range, min_duration_seconds: 400, max_duration_seconds: 800, rounding: 1, rounding_minutes: 30 };
  const rows = await ctx.json('POST', `${base}/search/time_entries`, body);
  assert.deepEqual(rows.body.map((r: any) => r.description), ['600']);
  assert.equal(rows.body[0].time_entries[0].seconds, 1800);
  assert.equal((await ctx.json('POST', `${base}/search/time_entries/totals`, body)).body.seconds, 1800);
  const invalid = await ctx.json('POST', `${base}/search/time_entries`, { ...range, min_duration_seconds: 800, max_duration_seconds: 400 });
  assert.equal(invalid.status, 400);
  for (const value of [-1, 1.5, '600']) {
    assert.equal((await ctx.json('POST', `${base}/search/time_entries`, { ...range, min_duration_seconds: value })).status, 400);
  }
});

test('totals honor explicit day granularity and resolution; granularity takes precedence', async () => {
  const ctx = (await setup());
  const range = (await reportFixture(ctx));
  const url = `/reports/api/v3/workspace/${ctx.wid}/search/time_entries/totals`;
  for (const options of [{ granularity: 'day' }, { resolution: 'day' }, { granularity: 'day', resolution: 'month' }]) {
    const result = await ctx.json('POST', url, { ...range, ...options, with_graph: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.resolution, 'day');
    assert.equal(result.body.graph.length, 92);
    assert.equal(result.body.graph.reduce((sum: number, point: any) => sum + point.seconds, 0), 1800);
  }
  assert.equal((await ctx.json('POST', url, { ...range, granularity: 'invalid' })).status, 400);
});
