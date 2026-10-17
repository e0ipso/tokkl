import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iso, setup, type TestContext } from './helpers.ts';
import { addWorkspaceMember, createWorkspace } from '../src/models/workspaces.ts';

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

// Continue and favorites (web `start(from, { replace: true })`) post a plain running entry;
// the server stops whatever runs at the new entry's start, snapped to the time resolution.
test('starting a second timer stops the first one at the new start, snapped to the resolution', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Alpha', billable: true });

  // Idle path: nothing runs, so the start simply creates the running entry.
  const first = await ctx.json('POST', url, { description: 'first', start: '2026-10-14T08:00:00Z', duration: -1, created_with: 'test' });
  assert.equal(first.status, 200);
  assert.equal(first.body.stop, null);
  assert.equal(runningCount(ctx), 1);

  const second = await ctx.json('POST', url, {
    description: 'second', start: '2026-10-14T09:13:20Z', duration: -1, project_id: project.body.id, tags: ['dev'], created_with: 'test',
  });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.id, first.body.id);
  assert.equal(second.body.start, '2026-10-14T09:13:20+00:00');
  assert.equal(second.body.stop, null);
  assert.equal(second.body.project_id, project.body.id);
  assert.equal(second.body.billable, true);
  assert.deepEqual(second.body.tags, ['dev']);

  // 73m20s rounds up to 75 minutes at the default resolution of 5, so the first entry overlaps
  // the second by 100 seconds, less than one step.
  const firstNow = await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`);
  assert.equal(firstNow.body.start, '2026-10-14T08:00:00+00:00');
  assert.equal(firstNow.body.stop, '2026-10-14T09:15:00+00:00');
  assert.equal(firstNow.body.duration, 4500);
  const overlap = (Date.parse(firstNow.body.stop) - Date.parse(second.body.start)) / 1000;
  assert.ok(overlap > 0 && overlap < 300, `overlap ${overlap}`);
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

// Timestamps must be RFC 3339 strings with a zone and a real calendar date.
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
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 1 })).status, 200);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  // Fractions of a second are dropped, then the span snaps to whole minutes: 09:00:20 is nearest
  // 09:00 and 89m50s rounds up to 90 minutes.
  const offset = await ctx.json('POST', url, { start: '2026-10-14T11:00:20.750+02:00', stop: '2026-10-14T12:30:10.999+02:00' });
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

  // A running entry keeps its exact start, to the second.
  const moved = await ctx.json('PUT', `${url}/${negativeEpoch.body.id}`, { start: '2026-10-14T16:30:07.400+02:00' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.start, '2026-10-14T14:30:07+00:00');
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

// References are validated through the lightweight project/task lookups.
test('entry project and task references are validated on create and update', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const url = `${base}/time_entries`;
  const billable = await ctx.json('POST', `${base}/projects`, { name: 'Billable', billable: true });
  const plain = await ctx.json('POST', `${base}/projects`, { name: 'Plain' });
  const task = await ctx.json('POST', `${base}/projects/${billable.body.id}/tasks`, { name: 'Design' });
  // The caller must belong to a workspace to write to it.
  const otherWid = createWorkspace(ctx.db, 'Other').id;
  addWorkspaceMember(ctx.db, otherWid, ctx.user.id, 'member');
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
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Tokkl', billable: true, color: '#0b83d9' });
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
  assert.equal(longer.body.project_name, 'Tokkl');
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

/** An instant as the API returns it, to the second with a +00:00 offset. */
function apiTime(date: Date): string {
  return `${date.toISOString().slice(0, 19)}+00:00`;
}

/** Asserts that `entry` was stored from `start` to `stop` and that its duration is stop minus start. */
function assertStored(ctx: TestContext, entry: any, start: string, stop: string): void {
  assert.equal(entry.start, start);
  assert.equal(entry.stop, stop);
  assert.equal(entry.duration, (Date.parse(stop) - Date.parse(start)) / 1000);
  const row = ctx.db.prepare('SELECT start, stop FROM time_entries WHERE id = ?').get(entry.id) as { start: string; stop: string };
  assert.deepEqual({ ...row }, { start: iso(start), stop: iso(stop) });
}

async function setResolution(ctx: TestContext, minutes: number): Promise<void> {
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: minutes })).status, 200);
}

test('create, update and bulk PATCH store the span snapped to the resolution', async () => {
  const ctx = await setup();
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;

  // 10:07:40 is nearer 10:15 than 10:00, and 23m25s rounds up to 30 minutes.
  const byStop = await ctx.json('POST', url, { start: '2026-10-14T10:07:40Z', stop: '2026-10-14T10:31:05Z' });
  assert.equal(byStop.status, 200);
  assertStored(ctx, byStop.body, '2026-10-14T10:15:00+00:00', '2026-10-14T10:45:00+00:00');

  const byDuration = await ctx.json('POST', url, { start: '2026-10-14T12:07:00Z', duration: 900 });
  assert.equal(byDuration.status, 200);
  assertStored(ctx, byDuration.body, '2026-10-14T12:00:00+00:00', '2026-10-14T12:15:00+00:00');

  const newStop = await ctx.json('PUT', `${url}/${byDuration.body.id}`, { stop: '2026-10-14T12:40:00Z' });
  assert.equal(newStop.status, 200);
  assertStored(ctx, newStop.body, '2026-10-14T12:00:00+00:00', '2026-10-14T12:45:00+00:00');

  // A start exactly halfway between two grid points goes to the later one; one second becomes a step.
  const newDuration = await ctx.json('PUT', `${url}/${byDuration.body.id}`, { start: '2026-10-14T13:52:30Z', duration: 1 });
  assert.equal(newDuration.status, 200);
  assertStored(ctx, newDuration.body, '2026-10-14T14:00:00+00:00', '2026-10-14T14:15:00+00:00');

  const patched = await ctx.json('PATCH', `${url}/${byStop.body.id},${byDuration.body.id}`, [
    { op: 'replace', path: '/stop', value: '2026-10-14T16:20:00Z' },
  ]);
  assert.deepEqual(patched.body, { success: [byStop.body.id, byDuration.body.id], failure: [] });
  // 6h05m and 2h20m round up to 6h15m and 2h30m.
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${byStop.body.id}`)).body,
    '2026-10-14T10:15:00+00:00', '2026-10-14T16:30:00+00:00');
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${byDuration.body.id}`)).body,
    '2026-10-14T14:00:00+00:00', '2026-10-14T16:30:00+00:00');
});

test('the grid follows the clock of the entry owner\'s timezone', async () => {
  const ctx = await setup({ timezone: 'Asia/Kolkata' });
  await setResolution(ctx, 60);
  // Kolkata is UTC+5:30, so its whole hours fall at half past in UTC.
  const entry = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-14T04:40:00Z', stop: '2026-10-14T05:20:00Z',
  });
  assert.equal(entry.status, 200);
  assertStored(ctx, entry.body, '2026-10-14T04:30:00+00:00', '2026-10-14T05:30:00+00:00');
});

test('a running entry keeps its exact start until the stop endpoint snaps it', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const realStart = new Date(Math.floor(Date.now() / 1000) * 1000 - 1_210_000);
  const running = await ctx.json('POST', url, { start: realStart.toISOString(), duration: -1 });
  assert.equal(running.status, 200);
  assert.equal(running.body.start, apiTime(realStart));
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body.start, apiTime(realStart));

  const before = Math.floor(Date.now() / 1000);
  const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`);
  const after = Math.ceil(Date.now() / 1000);
  assert.equal(stopped.status, 200);
  const start = Date.parse(stopped.body.start) / 1000;
  const stop = Date.parse(stopped.body.stop) / 1000;
  assert.equal(start % 300, 0);
  assert.ok(Math.abs(start - realStart.getTime() / 1000) <= 150, stopped.body.start);
  assert.equal(stopped.body.duration, stop - start);
  assert.equal(stopped.body.duration % 300, 0);
  assert.ok(stopped.body.duration >= before - realStart.getTime() / 1000, String(stopped.body.duration));
  assert.ok(stopped.body.duration < after - realStart.getTime() / 1000 + 300, String(stopped.body.duration));
  assertStored(ctx, stopped.body, stopped.body.start, stopped.body.stop);
});

test('a deleted running entry restored while another timer runs is stopped on the grid', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const realStart = new Date(Math.floor(Date.now() / 1000) * 1000 - 1_210_000);
  const deleted = await ctx.json('POST', url, { start: realStart.toISOString(), duration: -1 });
  await ctx.request('DELETE', `${url}/${deleted.body.id}`);
  await ctx.json('POST', url, { start: new Date().toISOString(), duration: -1 });

  const restored = await ctx.json('POST', `/api/app/time_entries/${deleted.body.id}/restore`);
  assert.equal(restored.status, 200);
  assert.notEqual(restored.body.stop, null);
  assert.equal((Date.parse(restored.body.start) / 1000) % 300, 0);
  assert.equal(restored.body.duration % 300, 0);
  assertStored(ctx, restored.body, restored.body.start, restored.body.stop);
});

test('the 999-hour cap applies to the snapped duration', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  // 999 hours is a multiple of every resolution, so a duration under the cap never snaps past it.
  const fits = await ctx.json('POST', url, { start: '2026-01-01T00:00:10Z', duration: 999 * 3600 - 10 });
  assert.equal(fits.status, 200);
  assertStored(ctx, fits.body, '2026-01-01T00:00:00+00:00', '2026-02-11T15:00:00+00:00');
  assert.equal(fits.body.duration, 999 * 3600);

  const over = await ctx.json('POST', url, { start: '2026-01-01T00:00:00Z', duration: 999 * 3600 + 1 });
  assert.equal(over.status, 400);
  assert.equal(over.body, 'Time entries can not be longer than 999 hours');
  const updated = await ctx.json('PUT', `${url}/${fits.body.id}`, { duration: 999 * 3600 + 1 });
  assert.equal(updated.status, 400);
  assert.equal(updated.body, 'Time entries can not be longer than 999 hours');
});

test('a timer left running past 999 hours stops at the cap, by hand or by a new timer', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const longAgo = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000 * 3600 * 1000).toISOString();

  const byHand = await ctx.json('POST', url, { start: longAgo, duration: -1 });
  const stopped = await ctx.json('PATCH', `${url}/${byHand.body.id}/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.duration, 999 * 3600);
  assert.equal((Date.parse(stopped.body.start) / 1000) % 300, 0);
  assertStored(ctx, stopped.body, stopped.body.start, stopped.body.stop);

  const forgotten = await ctx.json('POST', url, { start: longAgo, duration: -1 });
  const next = await ctx.json('POST', url, { start: new Date().toISOString(), duration: -1 });
  assert.equal(next.status, 200);
  assert.equal(next.body.stop, null);
  const old = (await ctx.json('GET', `/api/v9/me/time_entries/${forgotten.body.id}`)).body;
  assert.equal(old.duration, 999 * 3600);
  assertStored(ctx, old, old.start, old.stop);
});

test('bulk PATCH that removes every tag snaps the span like any other edit', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  for (const path of ['/tags', '/tag_ids']) {
    const entry = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 600, tags: ['client'] });
    ctx.db.prepare('UPDATE time_entries SET start = ?, stop = ? WHERE id = ?')
      .run('2026-10-14T09:02:31.000Z', '2026-10-14T09:13:07.000Z', entry.body.id);

    const patched = await ctx.json('PATCH', `${url}/${entry.body.id}`, [{ op: 'remove', path }]);
    assert.deepEqual(patched.body, { success: [entry.body.id], failure: [] }, path);
    const read = (await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`)).body;
    assert.deepEqual(read.tags, [], path);
    assertStored(ctx, read, '2026-10-14T09:05:00+00:00', '2026-10-14T09:20:00+00:00');
  }
});

test('an entry stored off the grid stays as it is until it is edited', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 600, description: 'old' });
  ctx.db.prepare('UPDATE time_entries SET start = ?, stop = ? WHERE id = ?')
    .run('2026-10-14T09:02:31.000Z', '2026-10-14T09:13:07.000Z', entry.body.id);

  const read = await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`);
  assertStored(ctx, read.body, '2026-10-14T09:02:31+00:00', '2026-10-14T09:13:07+00:00');
  const listed = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-14&end_date=2026-10-15');
  assert.equal(listed.body[0].duration, 636);

  const edited = await ctx.json('PUT', `${url}/${entry.body.id}`, { description: 'edited' });
  assert.equal(edited.status, 200);
  assertStored(ctx, edited.body, '2026-10-14T09:05:00+00:00', '2026-10-14T09:20:00+00:00');
});
