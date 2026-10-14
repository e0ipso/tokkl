import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';

test('starting a timer returns a running entry with negative epoch duration', async () => {
  const ctx = await setup();
  const start = '2026-10-14T09:00:00Z';
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    description: 'Write PRD', start, duration: -1, created_with: 'test', workspace_id: ctx.wid,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.stop, null);
  assert.equal(created.body.duration, -Date.parse(start) / 1000);
  assert.equal(created.body.start, '2026-10-14T09:00:00+00:00');
  assert.equal(created.body.wid, ctx.wid);
  assert.deepEqual(created.body.tags, []);

  const current = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(current.body.id, created.body.id);

  const stopped = await ctx.json('PATCH', `/api/v9/workspaces/${ctx.wid}/time_entries/${created.body.id}/stop`);
  assert.equal(stopped.status, 200);
  assert.ok(stopped.body.duration > 0);
  assert.ok(stopped.body.stop);

  const again = await ctx.json('PATCH', `/api/v9/workspaces/${ctx.wid}/time_entries/${created.body.id}/stop`);
  assert.equal(again.status, 409);
  assert.equal(again.body, 'Time entry already stopped');

  const none = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(none.status, 200);
  assert.equal(none.body, null);
});

test('starting a second timer stops the first one', async () => {
  const ctx = await setup();
  const first = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    description: 'first', start: new Date(Date.now() - 3600_000).toISOString(), duration: -1, created_with: 'test',
  });
  const second = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    description: 'second', start: new Date().toISOString(), duration: -1, created_with: 'test',
  });
  assert.equal(second.status, 200);
  const firstNow = await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`);
  assert.notEqual(firstNow.body.stop, null);
  assert.ok(firstNow.body.duration >= 3599);
  const current = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(current.body.id, second.body.id);
});

test('manual entries from duration or stop, and validation errors', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const byDuration = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 5400, created_with: 'test' });
  assert.equal(byDuration.body.stop, '2026-10-01T09:30:00+00:00');
  assert.equal(byDuration.body.duration, 5400);

  const byStop = await ctx.json('POST', url, { start: '2026-10-01T10:00:00+02:00', stop: '2026-10-01T11:00:00+02:00', created_with: 'test' });
  assert.equal(byStop.body.start, '2026-10-01T08:00:00+00:00');
  assert.equal(byStop.body.duration, 3600);

  const backwards = await ctx.json('POST', url, { start: '2026-10-01T10:00:00Z', stop: '2026-10-01T09:00:00Z', created_with: 'test' });
  assert.equal(backwards.status, 400);
  assert.equal(typeof backwards.body, 'string');

  const badProject = await ctx.json('POST', url, { start: '2026-10-01T10:00:00Z', duration: 60, project_id: 999 });
  assert.equal(badProject.status, 404);

  const wrongWs = await ctx.json('POST', '/api/v9/workspaces/999/time_entries', { start: '2026-10-01T10:00:00Z', duration: 60 });
  assert.equal(wrongWs.status, 403);

  const badJson = await ctx.request('POST', url, '{nope');
  assert.equal(badJson.status, 400);
});

test('tags by name are created, tag_action adds and deletes', async () => {
  const ctx = await setup();
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-01T08:00:00Z', duration: 60, tags: ['client-work', 'deep'], created_with: 'test',
  });
  assert.deepEqual(created.body.tags, ['client-work', 'deep']);
  const tags = await ctx.json('GET', `/api/v9/workspaces/${ctx.wid}/tags`);
  assert.equal(tags.body.length, 2);

  const url = `/api/v9/workspaces/${ctx.wid}/time_entries/${created.body.id}`;
  const added = await ctx.json('PUT', url, { tags: ['review'], tag_action: 'add' });
  assert.deepEqual(added.body.tags, ['client-work', 'deep', 'review']);
  const removed = await ctx.json('PUT', url, { tags: ['deep'], tag_action: 'delete' });
  assert.deepEqual(removed.body.tags, ['client-work', 'review']);
  const replaced = await ctx.json('PUT', url, { tags: ['solo'] });
  assert.deepEqual(replaced.body.tags, ['solo']);
});

test('updating start keeps stop; updating duration moves stop; meta fields', async () => {
  const ctx = await setup();
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Timetrack', billable: true, color: '#0b83d9' });
  const entry = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-01T08:00:00Z', stop: '2026-10-01T10:00:00Z', project_id: project.body.id, created_with: 'test',
  });
  assert.equal(entry.body.billable, true, 'inherits billable from the project');
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries/${entry.body.id}`;

  const moved = await ctx.json('PUT', url, { start: '2026-10-01T09:00:00Z' });
  assert.equal(moved.body.stop, '2026-10-01T10:00:00+00:00');
  assert.equal(moved.body.duration, 3600);

  const longer = await ctx.json('PUT', `${url}?meta=true`, { duration: 7200 });
  assert.equal(longer.body.stop, '2026-10-01T11:00:00+00:00');
  assert.equal(longer.body.project_name, 'Timetrack');
  assert.equal(longer.body.project_color, '#0b83d9');
});

test('listing filters: default window, date range, since with deleted entries', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const old = await ctx.json('POST', url, { start: '2026-01-10T10:00:00Z', duration: 60 });
  const recent = await ctx.json('POST', url, { start: new Date(Date.now() - 86_400_000).toISOString(), duration: 60 });

  const defaults = await ctx.json('GET', '/api/v9/me/time_entries');
  assert.deepEqual(defaults.body.map((e: any) => e.id), [recent.body.id]);

  // 2026-01-09T23:30Z is 2026-01-10 00:30 in Madrid, so it belongs to January 10th.
  const edge = await ctx.json('POST', url, { start: '2026-01-09T23:30:00Z', duration: 60 });
  const range = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-01-10&end_date=2026-01-11');
  assert.deepEqual(range.body.map((e: any) => e.id).sort(), [old.body.id, edge.body.id].sort());

  const lonely = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-01-10');
  assert.equal(lonely.status, 400);

  const before = Math.floor(Date.now() / 1000) - 1;
  const del = await ctx.request('DELETE', `${url}/${old.body.id}`);
  assert.equal(del.status, 200);
  const since = await ctx.json('GET', `/api/v9/me/time_entries?since=${before}`);
  const deleted = since.body.find((e: any) => e.id === old.body.id);
  assert.ok(deleted.server_deleted_at, 'deleted entries come back through since');

  const gone = await ctx.json('GET', `/api/v9/me/time_entries/${old.body.id}`);
  assert.equal(gone.status, 404);

  const restored = await ctx.json('POST', `/api/app/time_entries/${old.body.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.server_deleted_at, null);
});

test('bulk PATCH applies operations per entry and reports failures', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const a = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 60, tags: ['x'] });
  const b = await ctx.json('POST', url, { start: '2026-10-01T09:00:00Z', duration: 60 });
  const patched = await ctx.json('PATCH', `${url}/${a.body.id},${b.body.id},99999`, [
    { op: 'replace', path: '/description', value: 'bulk' },
    { op: 'replace', path: '/billable', value: true },
    { op: 'add', path: '/tags', value: ['y'] },
  ]);
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.success.sort(), [a.body.id, b.body.id].sort());
  assert.equal(patched.body.failure.length, 1);
  assert.equal(patched.body.failure[0].id, 99999);

  const after = await ctx.json('GET', `/api/v9/me/time_entries/${a.body.id}`);
  assert.equal(after.body.description, 'bulk');
  assert.equal(after.body.billable, true);
  assert.deepEqual(after.body.tags, ['x', 'y']);

  const bad = await ctx.json('PATCH', `${url}/${a.body.id}`, [{ op: 'replace', path: '/nope', value: 1 }]);
  assert.equal(bad.body.failure.length, 1);
  const unchanged = await ctx.json('GET', `/api/v9/me/time_entries/${a.body.id}`);
  assert.equal(unchanged.body.description, 'bulk');
});

test('trash lists deleted entries, restores and purges them', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const a = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 60, description: 'a' });
  const b = await ctx.json('POST', url, { start: '2026-10-01T09:00:00Z', duration: 60, description: 'b' });
  await ctx.request('DELETE', `${url}/${a.body.id}`);
  await ctx.request('DELETE', `${url}/${b.body.id}`);

  const trash = await ctx.json('GET', '/api/app/trash');
  assert.deepEqual(trash.body.map((e: any) => e.description).sort(), ['a', 'b']);

  const purgeOne = await ctx.json('DELETE', `/api/app/trash/${a.body.id}`);
  assert.equal(purgeOne.body.deleted, 1);
  assert.equal((await ctx.json('POST', `/api/app/time_entries/${a.body.id}/restore`)).status, 404);

  const empty = await ctx.json('DELETE', '/api/app/trash');
  assert.equal(empty.body.deleted, 1);
  assert.deepEqual((await ctx.json('GET', '/api/app/trash')).body, []);
});
