import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type TestContext } from './helpers.ts';
import { createWorkspace } from '../src/models/workspaces.ts';

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

function runningCount(ctx: TestContext): number {
  return (ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE stop IS NULL AND deleted_at IS NULL').get() as { n: number }).n;
}

// TT-0001: Continue and favorites (web `start(from, { replace: true })`) post a plain running entry;
// the server stops whatever runs at the new entry's start.
test('starting a second timer stops the first one exactly at the new start', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Alpha', billable: true });

  // Idle path: nothing runs, so the start simply creates the running entry.
  const first = await ctx.json('POST', url, { description: 'first', start: '2026-10-14T08:00:00Z', duration: -1, created_with: 'test' });
  assert.equal(first.status, 200);
  assert.equal(first.body.stop, null);
  assert.equal(runningCount(ctx), 1);

  const second = await ctx.json('POST', url, {
    description: 'second', start: '2026-10-14T09:15:00Z', duration: -1, project_id: project.body.id, tags: ['dev'], created_with: 'test',
  });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.id, first.body.id);
  assert.equal(second.body.stop, null);
  assert.equal(second.body.project_id, project.body.id);
  assert.equal(second.body.billable, true);
  assert.deepEqual(second.body.tags, ['dev']);

  const firstNow = await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`);
  assert.equal(firstNow.body.stop, second.body.start);
  assert.equal(firstNow.body.duration, 4500);
  const current = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(current.body.id, second.body.id);
  assert.equal(runningCount(ctx), 1);
});

test('concurrent timer starts leave exactly one running entry', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  await ctx.json('POST', url, { description: 'already running', start: '2026-10-14T07:00:00Z', duration: -1 });
  const starts = await Promise.all([1, 2, 3, 4, 5].map((i) =>
    ctx.json('POST', url, { description: `start ${i}`, start: `2026-10-14T08:0${i}:00Z`, duration: -1, created_with: 'test' })));
  assert.deepEqual(starts.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(new Set(starts.map((r) => r.body.id)).size, 5);
  assert.equal(runningCount(ctx), 1);
  const rows = ctx.db.prepare('SELECT start, stop FROM time_entries').all() as Array<{ start: string; stop: string | null }>;
  assert.equal(rows.length, 6);
  for (const row of rows) if (row.stop !== null) assert.ok(row.stop >= row.start, `${row.stop} >= ${row.start}`);
});

// TT-0009: timestamps must be RFC 3339 strings with a zone and a real calendar date.
test('zone-free, impossible and non-string timestamps are rejected without side effects', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const running = await ctx.json('POST', url, { description: 'running', start: '2026-10-14T08:00:00Z', duration: -1 });
  const entryUrl = `${url}/${running.body.id}`;

  for (const bad of ['2026-10-14T09:00:00', '2026-02-30T09:00:00Z', Date.parse('2026-10-14T09:00:00Z') / 1000]) {
    const label = JSON.stringify(bad);
    const start = await ctx.json('POST', url, { start: bad, duration: -1 });
    assert.equal(start.status, 400, label);
    assert.equal(start.body, 'Invalid start: expected an RFC 3339 timestamp');
    const stop = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', stop: bad });
    assert.equal(stop.status, 400, label);
    assert.equal(stop.body, 'Invalid stop: expected an RFC 3339 timestamp');

    const updateStop = await ctx.json('PUT', entryUrl, { stop: bad });
    assert.equal(updateStop.status, 400, label);
    assert.equal(updateStop.body, 'Invalid stop: expected an RFC 3339 timestamp');
    const updateStart = await ctx.json('PUT', entryUrl, { start: bad, description: 'changed' });
    assert.equal(updateStart.status, 400, label);
    const patched = await ctx.json('PATCH', entryUrl, [{ op: 'replace', path: '/stop', value: bad }]);
    assert.deepEqual(patched.body, { success: [], failure: [{ id: running.body.id, message: 'Invalid stop: expected an RFC 3339 timestamp' }] });
  }

  const current = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(current.body.id, running.body.id);
  assert.equal(current.body.start, '2026-10-14T08:00:00+00:00');
  assert.equal(current.body.stop, null);
  assert.equal(current.body.description, 'running');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n, 1);
});

test('offsets, null stop, sub-second values and negative running durations still work', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const offset = await ctx.json('POST', url, { start: '2026-10-14T11:00:00.750+02:00', stop: '2026-10-14T12:30:00.999+02:00' });
  assert.equal(offset.status, 200);
  assert.equal(offset.body.start, '2026-10-14T09:00:00+00:00');
  assert.equal(offset.body.stop, '2026-10-14T10:30:00+00:00');
  assert.equal(offset.body.duration, 5400);
  const stored = ctx.db.prepare('SELECT start, stop FROM time_entries WHERE id = ?').get(offset.body.id);
  assert.deepEqual({ ...stored }, { start: '2026-10-14T09:00:00.000Z', stop: '2026-10-14T10:30:00.000Z' });

  const nullStop = await ctx.json('POST', url, { start: '2026-10-14T13:00:00Z', stop: null });
  assert.equal(nullStop.status, 200);
  assert.equal(nullStop.body.stop, null);
  assert.equal(nullStop.body.duration, -Date.parse('2026-10-14T13:00:00Z') / 1000);

  const epochStart = '2026-10-14T14:00:00Z';
  const negativeEpoch = await ctx.json('POST', url, { start: epochStart, duration: -Date.parse(epochStart) / 1000 });
  assert.equal(negativeEpoch.status, 200);
  assert.equal(negativeEpoch.body.stop, null);
  assert.equal(negativeEpoch.body.duration, -Date.parse(epochStart) / 1000);
  const previous = await ctx.json('GET', `/api/v9/me/time_entries/${nullStop.body.id}`);
  assert.equal(previous.body.stop, '2026-10-14T14:00:00+00:00');

  const moved = await ctx.json('PUT', `${url}/${negativeEpoch.body.id}`, { start: '2026-10-14T16:30:00.400+02:00' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.start, '2026-10-14T14:30:00+00:00');
  assert.equal(moved.body.stop, null);
});

test('list start_date and end_date accept zoned instants and reject zone-free or impossible ones', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const inside = await ctx.json('POST', url, { start: '2026-10-01T10:00:00Z', duration: 60 });
  await ctx.json('POST', url, { start: '2026-10-01T13:00:00Z', duration: 60 });

  const zoned = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01T11:00:00%2B02:00&end_date=2026-10-01T12:00:00Z');
  assert.equal(zoned.status, 200);
  assert.deepEqual(zoned.body.map((e: any) => e.id), [inside.body.id]);

  for (const [start, end] of [['2026-10-01T09:00:00', '2026-10-01T12:00:00Z'], ['2026-10-01T09:00:00Z', '2026-02-30T12:00:00Z']]) {
    const bad = await ctx.json('GET', `/api/v9/me/time_entries?start_date=${start}&end_date=${end}`);
    assert.equal(bad.status, 400, `${start} ${end}`);
    assert.match(bad.body, /^Invalid (start_date|end_date): expected an RFC 3339 timestamp$/);
  }
});

// TT-0014: references are validated through the lightweight project/task lookups.
test('entry project and task references are validated on create and update', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const url = `${base}/time_entries`;
  const billable = await ctx.json('POST', `${base}/projects`, { name: 'Billable', billable: true });
  const plain = await ctx.json('POST', `${base}/projects`, { name: 'Plain' });
  const task = await ctx.json('POST', `${base}/projects/${billable.body.id}/tasks`, { name: 'Design' });
  const otherWid = createWorkspace(ctx.db, 'Other').id;
  const foreignProject = await ctx.json('POST', `/api/v9/workspaces/${otherWid}/projects`, { name: 'Foreign' });
  const foreignTask = await ctx.json('POST', `/api/v9/workspaces/${otherWid}/projects/${foreignProject.body.id}/tasks`, { name: 'Remote' });
  assert.equal(foreignTask.status, 200);

  const entry = { start: '2026-10-01T08:00:00Z', duration: 60 };
  const rejected: Array<[Record<string, unknown>, number, string]> = [
    [{ project_id: 999_999 }, 404, 'Project not found'],
    [{ task_id: 999_999 }, 404, 'Task not found'],
    [{ project_id: foreignProject.body.id }, 404, 'Project not found'],
    [{ task_id: foreignTask.body.id }, 404, 'Task not found'],
    [{ project_id: plain.body.id, task_id: task.body.id }, 400, 'Task does not belong to the project'],
  ];
  const created = await ctx.json('POST', url, { ...entry, project_id: plain.body.id });
  for (const [refs, status, message] of rejected) {
    const create = await ctx.json('POST', url, { ...entry, ...refs });
    assert.deepEqual([create.status, create.body], [status, message], `create ${JSON.stringify(refs)}`);
    const update = await ctx.json('PUT', `${url}/${created.body.id}`, refs);
    assert.deepEqual([update.status, update.body], [status, message], `update ${JSON.stringify(refs)}`);
  }
  const unchanged = await ctx.json('GET', `/api/v9/me/time_entries/${created.body.id}`);
  assert.equal(unchanged.body.project_id, plain.body.id);
  assert.equal(unchanged.body.task_id, null);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n, 1);

  // Billable follows a changed project unless the request says otherwise.
  assert.equal(created.body.billable, false);
  const switched = await ctx.json('PUT', `${url}/${created.body.id}`, { project_id: billable.body.id, task_id: task.body.id });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.task_id, task.body.id);
  assert.equal(switched.body.billable, true);
  const sameProject = await ctx.json('PUT', `${url}/${created.body.id}`, { project_id: billable.body.id, billable: false });
  assert.equal(sameProject.body.billable, false);
  const toPlain = await ctx.json('PUT', `${url}/${created.body.id}`, { project_id: plain.body.id });
  assert.equal(toPlain.body.task_id, null, 'changing the project drops the old task');
  assert.equal(toPlain.body.billable, false);
  const explicit = await ctx.json('PUT', `${url}/${created.body.id}`, { project_id: billable.body.id, billable: false });
  assert.equal(explicit.body.billable, false);
  const byTask = await ctx.json('POST', url, { ...entry, task_id: task.body.id });
  assert.equal(byTask.body.project_id, billable.body.id);
  assert.equal(byTask.body.billable, true, 'a task brings its project and the project billable default');
  const explicitCreate = await ctx.json('POST', url, { ...entry, project_id: billable.body.id, billable: false });
  assert.equal(explicitCreate.body.billable, false);

  const archived = await ctx.json('PUT', `${base}/projects/${plain.body.id}`, { active: false });
  assert.equal(archived.body.active, false);
  const archivedTask = await ctx.json('POST', `${base}/projects/${plain.body.id}/tasks`, { name: 'Late' });
  assert.deepEqual([archivedTask.status, archivedTask.body], [400, 'Can not change tasks of archived project']);
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
