import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';

test('clients CRUD, archive cascades to projects, restore', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME', notes: 'net 30' });
  assert.equal(client.status, 200);
  assert.equal(client.body.wid, ctx.wid);
  assert.equal(client.body.archived, false);

  const dup = await ctx.json('POST', `${base}/clients`, { name: 'acme' });
  assert.equal(dup.status, 400);

  const project = await ctx.json('POST', `${base}/projects`, { name: 'Website', client_id: client.body.id });
  assert.equal(project.body.client_id, client.body.id);
  assert.equal(project.body.cid, client.body.id);
  assert.equal(project.body.client_name, 'ACME');
  assert.match(project.body.color, /^#[0-9a-f]{6}$/);

  const archived = await ctx.json('POST', `${base}/clients/${client.body.id}/archive`);
  assert.deepEqual(archived.body, [project.body.id]);
  const archivedProject = await ctx.json('GET', `${base}/projects/${project.body.id}`);
  assert.equal(archivedProject.body.active, false);
  assert.equal(archivedProject.body.status, 'archived');

  const activeOnly = await ctx.json('GET', `${base}/clients?status=active`);
  assert.equal(activeOnly.body.length, 0);

  const restored = await ctx.json('POST', `${base}/clients/${client.body.id}/restore`);
  assert.equal(restored.body.archived, false);

  const renamed = await ctx.json('PUT', `${base}/clients/${client.body.id}`, { name: 'ACME Corp' });
  assert.equal(renamed.body.name, 'ACME Corp');

  assert.equal((await ctx.request('DELETE', `${base}/clients/${client.body.id}`)).status, 200);
  const orphan = await ctx.json('GET', `${base}/projects/${project.body.id}`);
  assert.equal(orphan.body.client_id, null);
});

test('projects: filters, actual_seconds, delete keeps or removes entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const a = await ctx.json('POST', `${base}/projects`, { name: 'Alpha', billable: true, rate: 80, currency: 'eur', estimated_hours: 10 });
  assert.equal(a.body.currency, 'EUR');
  assert.equal(a.body.estimated_seconds, 36000);
  const b = await ctx.json('POST', `${base}/projects`, { name: 'Beta', active: false });

  await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 5400, project_id: a.body.id });
  const withTime = await ctx.json('GET', `${base}/projects/${a.body.id}`);
  assert.equal(withTime.body.actual_seconds, 5400);
  assert.equal(withTime.body.actual_hours, 1);

  const active = await ctx.json('GET', `${base}/projects?active=true`);
  assert.deepEqual(active.body.map((p: any) => p.name), ['Alpha']);
  const both = await ctx.json('GET', `${base}/projects`);
  assert.equal(both.body.length, 2);
  const me = await ctx.json('GET', '/api/v9/me/projects');
  assert.deepEqual(me.body.map((p: any) => p.name), ['Alpha']);

  const badColor = await ctx.json('PUT', `${base}/projects/${b.body.id}`, { color: 'red' });
  assert.equal(badColor.status, 400);

  const entries = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02');
  assert.equal(entries.body.length, 1);
  assert.equal((await ctx.request('DELETE', `${base}/projects/${a.body.id}`)).status, 200);
  const kept = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02');
  assert.equal(kept.body.length, 1);
  assert.equal(kept.body[0].project_id, null);
});

test('tasks belong to projects and set the project on entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha' });
  const other = await ctx.json('POST', `${base}/projects`, { name: 'Other' });
  const task = await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design', estimated_seconds: 3600 });
  assert.equal(task.status, 200);
  assert.equal(task.body.project_id, project.body.id);

  const entry = await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60, task_id: task.body.id });
  assert.equal(entry.body.project_id, project.body.id);
  const mismatch = await ctx.json('POST', `${base}/time_entries`, {
    start: '2026-10-01T08:00:00Z', duration: 60, task_id: task.body.id, project_id: other.body.id,
  });
  assert.equal(mismatch.status, 400);

  const listed = await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].tracked_seconds, 60_000);
  const done = await ctx.json('PUT', `${base}/projects/${project.body.id}/tasks/${task.body.id}`, { active: false });
  assert.equal(done.body.active, false);
});

test('tags: create, rename, duplicate check, delete removes from entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const tag = await ctx.json('POST', `${base}/tags`, { name: 'urgent' });
  assert.equal(tag.status, 200);
  assert.equal(tag.body.name, 'urgent');
  assert.equal((await ctx.json('POST', `${base}/tags`, { name: 'URGENT' })).status, 400);
  assert.equal((await ctx.json('POST', `${base}/tags`, { name: '  ' })).status, 400);

  const entry = await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60, tag_ids: [tag.body.id] });
  assert.deepEqual(entry.body.tags, ['urgent']);
  const renamed = await ctx.json('PUT', `${base}/tags/${tag.body.id}`, { name: 'later' });
  assert.equal(renamed.body.name, 'later');
  assert.equal((await ctx.request('DELETE', `${base}/tags/${tag.body.id}`)).status, 200);
  const after = await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`);
  assert.deepEqual(after.body.tags, []);
});

test('preferences merge and /me with related data', async () => {
  const ctx = await setup();
  const saved = await ctx.json('POST', '/api/v9/me/preferences', { duration_format: 'decimal', custom_key: 1 });
  assert.equal(saved.body.duration_format, 'decimal');
  const read = await ctx.json('GET', '/api/v9/me/preferences');
  assert.equal(read.body.custom_key, 1);
  assert.equal(read.body.timeofday_format, 'H:mm');

  const related = await ctx.json('GET', '/api/v9/me?with_related_data=true');
  assert.equal(related.body.workspaces.length, 1);
  assert.ok(Array.isArray(related.body.projects));

  const ws = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}`, { name: 'Home', default_currency: 'usd', default_hourly_rate: 50 });
  assert.equal(ws.body.name, 'Home');
  assert.equal(ws.body.default_currency, 'USD');
});

test('task listings follow Toggl shapes: workspace envelope, project array, paging', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha' });
  for (const name of ['a', 'b', 'c']) await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name });
  const last = await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`);
  await ctx.json('PUT', `${base}/projects/${project.body.id}/tasks/${last.body[2].id}`, { active: false });

  const envelope = await ctx.json('GET', `${base}/tasks?per_page=2&active=both`);
  assert.equal(envelope.body.total_count, 3);
  assert.equal(envelope.body.data.length, 2);
  assert.equal(envelope.body.page, 1);

  assert.equal((await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`)).body.length, 3);
  assert.equal((await ctx.json('GET', `${base}/projects/${project.body.id}/tasks?active=true`)).body.length, 2);
  assert.equal((await ctx.json('GET', '/api/v9/me/tasks')).body.length, 2);
  assert.equal((await ctx.json('GET', '/api/v9/me/tasks?include_not_active=true')).body.length, 3);

  for (const name of ['p1', 'p2']) await ctx.json('POST', `${base}/projects`, { name });
  assert.equal((await ctx.json('GET', `${base}/projects`)).body.length, 3);
  assert.equal((await ctx.json('GET', `${base}/projects?per_page=2&page=2`)).body.length, 1);
});

test('client_id null clears a project client; legacy cid still works', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME' });
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Site', cid: client.body.id });
  assert.equal(project.body.client_id, client.body.id);
  const cleared = await ctx.json('PUT', `${base}/projects/${project.body.id}`, { client_id: null });
  assert.equal(cleared.body.client_id, null);
  const renamed = await ctx.json('PUT', `${base}/projects/${project.body.id}`, { name: 'Site 2' });
  assert.equal(renamed.body.client_id, null);
});
