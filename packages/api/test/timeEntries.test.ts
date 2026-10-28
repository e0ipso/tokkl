import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, iso, setup, type TestContext } from './helpers.ts';
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

  // 09:13:20 is nearer 09:15 than 09:10 at the default resolution of 5, so the first entry stops there.
  const firstNow = await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`);
  assert.equal(firstNow.body.start, '2026-10-14T08:00:00+00:00');
  assert.equal(firstNow.body.stop, '2026-10-14T09:15:00+00:00');
  assert.equal(firstNow.body.duration, 4500);
  const current = await ctx.json('GET', '/api/v9/me/time_entries/current');
  assert.equal(current.body.id, second.body.id);
  assert.equal(runningCount(ctx), 1);

  // Once the second entry stops, its start snaps to the point where the first one stopped.
  const secondNow = await ctx.json('PATCH', `${url}/${second.body.id}/stop`);
  assert.equal(secondNow.body.start, firstNow.body.stop);
});

test('a switch between timers is stored back to back on either side of a half step', async () => {
  for (const [minutes, switchAt, stop] of [
    [5, '09:12:00', '09:10:00'], [5, '09:12:30', '09:15:00'], [5, '09:13:00', '09:15:00'],
    [15, '09:22:00', '09:15:00'], [15, '09:22:30', '09:30:00'], [15, '09:23:00', '09:30:00'],
  ] as const) {
    const ctx = await setup();
    await setResolution(ctx, minutes);
    const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
    const label = `R=${minutes} switch at ${switchAt}`;
    const first = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: -1 });
    const second = await ctx.json('POST', url, { start: `2026-10-14T${switchAt}Z`, duration: -1 });
    const stopped = await ctx.json('PATCH', `${url}/${second.body.id}/stop`);
    assert.equal(stopped.status, 200, label);
    const old = (await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`)).body;
    assertStored(ctx, old, '2026-10-14T09:00:00+00:00', `2026-10-14T${stop}+00:00`);
    assert.equal(stopped.body.start, old.stop, label);
  }
});

test('a switch within half a step of the old start sends the old entry to the trash at zero length', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const first = await ctx.json('POST', url, { start: '2026-10-14T09:00:40Z', duration: -1 });
  await ctx.json('POST', url, { start: '2026-10-14T09:02:20Z', duration: -1 });
  assert.equal((await ctx.json('GET', `/api/v9/me/time_entries/${first.body.id}`)).status, 404);
  const row = ctx.db.prepare('SELECT start, stop, deleted_at FROM time_entries WHERE id = ?').get(first.body.id) as
    { start: string; stop: string; deleted_at: string | null };
  assert.deepEqual({ start: row.start, stop: row.stop }, { start: '2026-10-14T09:00:00.000Z', stop: '2026-10-14T09:00:00.000Z' });
  assert.ok(row.deleted_at);
  assert.deepEqual((await ctx.json('GET', '/api/app/trash')).body.map((entry: any) => entry.id), [first.body.id]);
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
  // Fractions of a second are dropped, then each end snaps to the nearest whole minute: 09:00:20 to
  // 09:00 and 10:30:10 to 10:30.
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
  const inside = await ctx.json('POST', url, { start: '2026-10-01T10:00:00Z', duration: 600 });
  await ctx.json('POST', url, { start: '2026-10-01T13:00:00Z', duration: 600 });

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

  const entry = { start: '2026-10-01T08:00:00Z', duration: 600 };
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

  const badProject = await ctx.json('POST', url, { start: '2026-10-01T10:00:00Z', duration: 600, project_id: 999 });
  assert.equal(badProject.status, 404);

  const wrongWs = await ctx.json('POST', '/api/v9/workspaces/999/time_entries', { start: '2026-10-01T10:00:00Z', duration: 600 });
  assert.equal(wrongWs.status, 403);

  const badJson = await ctx.request('POST', url, '{nope');
  assert.equal(badJson.status, 400);
});

test('tags by name are created, tag_action adds and deletes', async () => {
  const ctx = await setup();
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-01T08:00:00Z', duration: 600, tags: ['client-work', 'deep'], created_with: 'test',
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
  const old = await ctx.json('POST', url, { start: '2026-01-10T10:00:00Z', duration: 600 });
  const recent = await ctx.json('POST', url, { start: new Date(Date.now() - 86_400_000).toISOString(), duration: 600 });

  const defaults = await ctx.json('GET', '/api/v9/me/time_entries');
  assert.deepEqual(defaults.body.map((e: any) => e.id), [recent.body.id]);

  // 2026-01-09T23:30Z is 2026-01-10 00:30 in Madrid, so it belongs to January 10th.
  const edge = await ctx.json('POST', url, { start: '2026-01-09T23:30:00Z', duration: 600 });
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
  const a = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 600, tags: ['x'] });
  const b = await ctx.json('POST', url, { start: '2026-10-01T09:00:00Z', duration: 600 });
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
  const a = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 600, description: 'a' });
  const b = await ctx.json('POST', url, { start: '2026-10-01T09:00:00Z', duration: 600, description: 'b' });
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

  // 10:07:40 is nearer 10:15 than 10:00, and 10:37:25 is nearer 10:30 than 10:45.
  const byStop = await ctx.json('POST', url, { start: '2026-10-14T10:07:40Z', stop: '2026-10-14T10:37:25Z' });
  assert.equal(byStop.status, 200);
  assertStored(ctx, byStop.body, '2026-10-14T10:15:00+00:00', '2026-10-14T10:30:00+00:00');

  const byDuration = await ctx.json('POST', url, { start: '2026-10-14T12:07:00Z', duration: 900 });
  assert.equal(byDuration.status, 200);
  assertStored(ctx, byDuration.body, '2026-10-14T12:00:00+00:00', '2026-10-14T12:15:00+00:00');

  const newStop = await ctx.json('PUT', `${url}/${byDuration.body.id}`, { stop: '2026-10-14T12:40:00Z' });
  assert.equal(newStop.status, 200);
  assertStored(ctx, newStop.body, '2026-10-14T12:00:00+00:00', '2026-10-14T12:45:00+00:00');

  // Either end exactly halfway between two grid points goes to the later one.
  const newDuration = await ctx.json('PUT', `${url}/${byDuration.body.id}`, { start: '2026-10-14T13:52:30Z', duration: 900 });
  assert.equal(newDuration.status, 200);
  assertStored(ctx, newDuration.body, '2026-10-14T14:00:00+00:00', '2026-10-14T14:15:00+00:00');

  const patched = await ctx.json('PATCH', `${url}/${byStop.body.id},${byDuration.body.id}`, [
    { op: 'replace', path: '/stop', value: '2026-10-14T16:20:00Z' },
  ]);
  assert.deepEqual(patched.body, { success: [byStop.body.id, byDuration.body.id], failure: [] });
  // 16:20 is nearer 16:15 than 16:30.
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${byStop.body.id}`)).body,
    '2026-10-14T10:15:00+00:00', '2026-10-14T16:15:00+00:00');
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${byDuration.body.id}`)).body,
    '2026-10-14T14:00:00+00:00', '2026-10-14T16:15:00+00:00');
});

test('create, update and bulk PATCH refuse a span that rounds to zero', async () => {
  const ctx = await setup();
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const message = 'Time entry is too short: it rounds to zero at the 15-minute time resolution';
  const entry = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 1800 });

  // Under half a step, even across a half-step mark; and 14 minutes whose ends both snap to 09:15.
  for (const [start, stop] of [['09:07:00', '09:07:59'], ['09:00:00', '09:00:00'], ['09:08:00', '09:22:00']]) {
    const body = { start: `2026-10-14T${start}Z`, stop: `2026-10-14T${stop}Z` };
    const created = await ctx.json('POST', url, body);
    assert.deepEqual([created.status, created.body], [400, message], `create ${start}-${stop}`);
    const updated = await ctx.json('PUT', `${url}/${entry.body.id}`, body);
    assert.deepEqual([updated.status, updated.body], [400, message], `update ${start}-${stop}`);
  }
  const patched = await ctx.json('PATCH', `${url}/${entry.body.id}`, [{ op: 'replace', path: '/duration', value: 60 }]);
  assert.deepEqual(patched.body, { success: [], failure: [{ id: entry.body.id, message }] });
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`)).body,
    '2026-10-14T09:00:00+00:00', '2026-10-14T09:30:00+00:00');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n, 1);
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
  // The stop goes to the grid point nearest the moment the request stopped the timer.
  assert.equal(stop % 300, 0);
  assert.ok(stop >= before - 150 && stop <= after + 150, stopped.body.stop);
  assert.equal(stopped.body.duration, stop - start);
  assertStored(ctx, stopped.body, stopped.body.start, stopped.body.stop);
});

test('the stop endpoint sends a timer shorter than half a step to the trash at zero length', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const realStart = new Date(Math.floor(Date.now() / 1000) * 1000 - 30_000);
  const running = await ctx.json('POST', url, { start: realStart.toISOString(), duration: -1, description: 'oops', tags: ['x'] });
  const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`);
  // The reply still describes the entry, so a client can resume it, and its duration adds nothing.
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.duration, 0);
  assert.equal(stopped.body.stop, stopped.body.start);
  assert.equal((Date.parse(stopped.body.start) / 1000) % 300, 0);
  assert.ok(stopped.body.server_deleted_at);
  assert.equal(stopped.body.description, 'oops');
  assert.deepEqual(stopped.body.tags, ['x']);
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body, null);
  assert.deepEqual((await ctx.json('GET', '/api/app/trash')).body.map((entry: any) => entry.id), [running.body.id]);

  const restored = await ctx.json('POST', `/api/app/time_entries/${running.body.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.server_deleted_at, null);
  assertStored(ctx, restored.body, stopped.body.start, stopped.body.start);
});

test('the stop endpoint stops at a supplied timestamp on the grid, whatever its offset', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const running = await ctx.json('POST', url, { start: '2026-10-14T09:02:10Z', duration: -1, description: 'session' });
  const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`, { stop: '2026-10-14T11:28:40.750+02:00' });
  assert.equal(stopped.status, 200);
  assertStored(ctx, stopped.body, '2026-10-14T09:00:00+00:00', '2026-10-14T09:30:00+00:00');
  assert.equal(stopped.body.server_deleted_at, null);

  const zoned = await setup({ timezone: 'Asia/Kathmandu' });
  await setResolution(zoned, 20);
  const zonedUrl = `/api/v9/workspaces/${zoned.wid}/time_entries`;
  const other = await zoned.json('POST', zonedUrl, { start: '2026-10-14T09:02:10Z', duration: -1 });
  const snapped = await zoned.json('PATCH', `${zonedUrl}/${other.body.id}/stop`, { stop: '2026-10-14T15:31:00+05:45' });
  assert.equal(snapped.status, 200);
  // 14:47:10 and 15:31 in Kathmandu snap to 14:40 and 15:40 on its 20-minute grid.
  assertStored(zoned, snapped.body, '2026-10-14T08:55:00+00:00', '2026-10-14T09:55:00+00:00');
});

test('a supplied stop within half a step of the start, or before it, trashes the timer for Undo', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  for (const stop of ['2026-10-14T09:01:00Z', '2026-10-14T08:00:00Z']) {
    const running = await ctx.json('POST', url, { start: '2026-10-14T09:00:30Z', duration: -1, description: 'short' });
    const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`, { stop });
    assert.equal(stopped.status, 200, stop);
    assert.equal(stopped.body.duration, 0);
    assert.equal(stopped.body.start, '2026-10-14T09:00:00+00:00');
    assert.equal(stopped.body.stop, stopped.body.start);
    assert.ok(stopped.body.server_deleted_at);
    assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body, null);
    const restored = await ctx.json('POST', `/api/app/time_entries/${running.body.id}/restore`);
    assert.equal(restored.status, 200);
    assertStored(ctx, restored.body, stopped.body.start, stopped.body.start);
  }
});

test('the stop endpoint rejects a stop that is not an RFC 3339 timestamp and leaves the timer running', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const running = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: -1 });
  for (const stop of [
    null, 1_792_576_920, true, {}, ['2026-10-14T09:30:00Z'], '', 'yesterday', '2026-10-14',
    '2026-10-14T09:30:00', '2026-10-14 09:30:00Z', '2026-10-14t09:30:00z', '2026-10-14T09:30Z',
    '2026-02-30T09:30:00Z', '2026-10-14T24:00:00Z', '2026-10-14T09:60:00Z', '2026-10-14T09:30:60Z',
    '2026-10-14T09:30:00+24:00', '2026-10-14T09:30:00+02:60', '2026-10-14T09:30:00+0200',
  ]) {
    const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`, { stop });
    assert.equal(stopped.status, 400, JSON.stringify(stop));
    assert.equal(stopped.body, 'Invalid stop: expected an RFC 3339 timestamp');
  }
  for (const body of [[], 'stop']) {
    assert.equal((await ctx.json('PATCH', `${url}/${running.body.id}/stop`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries/current')).body.id, running.body.id);
});

test('a stop body without a timestamp stops at the request time, as before', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const realStart = new Date(Math.floor(Date.now() / 1000) * 1000 - 1_210_000);
  const running = await ctx.json('POST', url, { start: realStart.toISOString(), duration: -1 });
  const before = Math.floor(Date.now() / 1000);
  const stopped = await ctx.json('PATCH', `${url}/${running.body.id}/stop`, { description: 'ignored' });
  const after = Math.ceil(Date.now() / 1000);
  assert.equal(stopped.status, 200);
  const stop = Date.parse(stopped.body.stop) / 1000;
  assert.equal(stop % 300, 0);
  assert.ok(stop >= before - 150 && stop <= after + 150, stopped.body.stop);
  assert.equal(stopped.body.description, '');
});

test('a supplied stop never reaches another account’s timer or a stopped entry', async () => {
  const ctx = await setup();
  const other = await addUser(ctx, { email: 'other@example.com', role: 'user' });
  const theirs = await other.json('POST', `/api/v9/workspaces/${other.wid}/time_entries`, { start: '2026-10-14T09:00:00Z', duration: -1 });
  const stop = { stop: '2026-10-14T09:30:00Z' };
  assert.equal((await ctx.json('PATCH', `/api/v9/workspaces/${ctx.wid}/time_entries/${theirs.body.id}/stop`, stop)).status, 404);
  assert.equal((await ctx.json('PATCH', `/api/v9/workspaces/${other.wid}/time_entries/${theirs.body.id}/stop`, stop)).status, 403);
  assert.equal((await other.json('GET', '/api/v9/me/time_entries/current')).body.stop, null);

  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const mine = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: -1 });
  assert.equal((await ctx.json('PATCH', `${url}/${mine.body.id}/stop`, stop)).status, 200);
  const again = await ctx.json('PATCH', `${url}/${mine.body.id}/stop`, { stop: '2026-10-14T10:00:00Z' });
  assert.equal(again.status, 409);
  assert.equal(again.body, 'Time entry already stopped');
  assertStored(ctx, (await ctx.json('GET', `/api/v9/me/time_entries/${mine.body.id}`)).body, '2026-10-14T09:00:00+00:00', '2026-10-14T09:30:00+00:00');
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

test('the 999-hour cap applies to the snapped span', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  // 999 hours is a multiple of every resolution, so a duration under the cap never snaps past it.
  const fits = await ctx.json('POST', url, { start: '2026-01-01T00:00:10Z', duration: 999 * 3600 - 10 });
  assert.equal(fits.status, 200);
  assertStored(ctx, fits.body, '2026-01-01T00:00:00+00:00', '2026-02-11T15:00:00+00:00');
  assert.equal(fits.body.duration, 999 * 3600);

  // A stop under half a step past the cap snaps back onto it; half a step snaps past it.
  const snapsBack = await ctx.json('POST', url, { start: '2026-01-01T00:00:00Z', duration: 999 * 3600 + 149 });
  assert.equal(snapsBack.status, 200);
  assert.equal(snapsBack.body.duration, 999 * 3600);
  const over = await ctx.json('POST', url, { start: '2026-01-01T00:00:00Z', duration: 999 * 3600 + 150 });
  assert.equal(over.status, 400);
  assert.equal(over.body, 'Time entries can not be longer than 999 hours');
  const updated = await ctx.json('PUT', `${url}/${fits.body.id}`, { duration: 999 * 3600 + 150 });
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
    assertStored(ctx, read, '2026-10-14T09:05:00+00:00', '2026-10-14T09:15:00+00:00');
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
  assertStored(ctx, edited.body, '2026-10-14T09:05:00+00:00', '2026-10-14T09:15:00+00:00');
});

test('an older entry that rounds to zero keeps its times through edits that leave them alone', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 600 });
  ctx.db.prepare('UPDATE time_entries SET start = ?, stop = ? WHERE id = ?')
    .run('2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z', entry.body.id);

  const renamed = await ctx.json('PUT', `${url}/${entry.body.id}`, { description: 'renamed' });
  assert.equal(renamed.status, 200);
  assertStored(ctx, renamed.body, '2026-10-14T09:00:00+00:00', '2026-10-14T09:00:00+00:00');
  const moved = await ctx.json('PUT', `${url}/${entry.body.id}`, { start: '2026-10-14T09:01:00Z' });
  assert.equal(moved.status, 400);
});

function entryCount(ctx: TestContext): number {
  return (ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n;
}

test('a no-time entry starts at local midnight and keeps a snapped duration', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;

  // 5000 seconds is nearer 5400 than 4500 at 15 minutes.
  const byDate = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 5000, description: 'reading' });
  assert.equal(byDate.status, 200);
  assertStored(ctx, byDate.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:30:00+00:00');
  assert.equal(byDate.body.duration, 5400);
  assert.equal(byDate.body.all_day, true);
  assert.equal(byDate.body.duronly, true);
  const row = ctx.db.prepare('SELECT all_day FROM time_entries WHERE id = ?').get(byDate.body.id) as { all_day: number };
  assert.equal(row.all_day, 1);

  // 23:30Z on the 14th is already the 15th in Madrid. A duration of exactly half a step goes up.
  const byStart = await ctx.json('POST', url, { all_day: true, start: '2026-10-14T23:30:00Z', duration: 450 });
  assert.equal(byStart.status, 200);
  assertStored(ctx, byStart.body, '2026-10-14T22:00:00+00:00', '2026-10-14T22:15:00+00:00');

  const byStop = await ctx.json('POST', url, { all_day: true, start: '2026-10-16T09:10:00+02:00', stop: '2026-10-16T17:10:00+02:00' });
  assert.equal(byStop.status, 200);
  assertStored(ctx, byStop.body, '2026-10-15T22:00:00+00:00', '2026-10-16T06:00:00+00:00');

  const timed = await ctx.json('POST', url, { all_day: false, start: '2026-10-14T09:07:00Z', duration: 900 });
  assert.equal(timed.status, 200);
  assertStored(ctx, timed.body, '2026-10-14T09:00:00+00:00', '2026-10-14T09:15:00+00:00');
  assert.equal(timed.body.all_day, false);
});

test('a no-time entry that is running, rounds to zero, runs over a day or has no duration is refused', async () => {
  const ctx = await setup({ timezone: 'America/New_York' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ duration: 0 }, 'Time entry is too short: it rounds to zero at the 15-minute time resolution'],
    [{ duration: 449 }, 'Time entry is too short: it rounds to zero at the 15-minute time resolution'],
    [{ duration: 90000 }, 'No-time entries can not be longer than 24 hours'],
    [{ duration: -1 }, 'No-time entries can not be running'],
    [{}, 'No-time entries need a duration'],
    [{ start_date: '2026-02-30', duration: 3600 }, 'Invalid start_date: expected YYYY-MM-DD'],
  ];
  for (const [body, message] of cases) {
    const created = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', ...body });
    assert.deepEqual([created.status, created.body], [400, message], JSON.stringify(body));
  }
  assert.equal(entryCount(ctx), 0);
  assert.equal(runningCount(ctx), 0);

  const day = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 86400 });
  assert.equal(day.status, 200);
  assert.equal(day.body.duration, 86400);
});

test('entry lists and since sync return all_day', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const before = Math.floor(Date.now() / 1000) - 1;
  const noTime = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 3600 });
  const timed = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 600 });
  const flags = (entries: any[]) => Object.fromEntries(entries.map((e) => [e.id, e.all_day]));
  const expected = { [noTime.body.id]: true, [timed.body.id]: false };

  const range = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-14&end_date=2026-10-15');
  assert.deepEqual(flags(range.body), expected);
  const withMeta = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-14&end_date=2026-10-15&meta=true');
  assert.deepEqual(flags(withMeta.body), expected);
  const since = await ctx.json('GET', `/api/v9/me/time_entries?since=${before}`);
  assert.deepEqual(flags(since.body), expected);
});

test('changing the account timezone moves no-time entries to midnight of the same day, trashed ones too', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const kept = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 5400 });
  const trashed = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-25', duration: 1800 });
  const timed = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 600 });
  assert.equal((await ctx.json('DELETE', `${url}/${trashed.body.id}`)).status, 200);
  ctx.db.prepare("UPDATE time_entries SET updated_at = '2026-01-01T00:00:00Z'").run();
  const storedOf = (id: number) => ctx.db.prepare('SELECT start, stop, updated_at FROM time_entries WHERE id = ?').get(id) as
    { start: string; stop: string; updated_at: string };
  const timedBefore = storedOf(timed.body.id);

  const same = await ctx.json('PUT', '/api/v9/me', { timezone: 'europe/madrid', fullname: 'Same Zone' });
  assert.equal(same.status, 200);
  const untouched = await ctx.json('PUT', '/api/v9/me', { fullname: 'No Zone' });
  assert.equal(untouched.status, 200);
  assert.equal(storedOf(kept.body.id).updated_at, '2026-01-01T00:00:00Z');

  const changed = await ctx.json('PUT', '/api/v9/me', { timezone: 'America/New_York' });
  assert.equal(changed.status, 200);

  // 2026-10-14 is on daylight time in New York (UTC-4); the 25th is too, until the 1st of November.
  assert.deepEqual(
    { start: storedOf(kept.body.id).start, stop: storedOf(kept.body.id).stop },
    { start: '2026-10-14T04:00:00.000Z', stop: '2026-10-14T05:30:00.000Z' },
  );
  assert.deepEqual(
    { start: storedOf(trashed.body.id).start, stop: storedOf(trashed.body.id).stop },
    { start: '2026-10-25T04:00:00.000Z', stop: '2026-10-25T04:30:00.000Z' },
  );
  assert.notEqual(storedOf(trashed.body.id).updated_at, '2026-01-01T00:00:00Z');
  assert.deepEqual(storedOf(timed.body.id), timedBefore);

  const since = await ctx.json('GET', `/api/v9/me/time_entries?since=${Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000)}`);
  const moved = since.body.find((entry: any) => entry.id === kept.body.id);
  assert.equal(moved.start, '2026-10-14T04:00:00+00:00');
  assert.equal(moved.duration, 5400);
  assert.equal(moved.all_day, true);
  assert.ok(Date.parse(moved.at) > Date.parse('2026-06-01T00:00:00Z'));
  assert.equal(since.body.some((entry: any) => entry.id === timed.body.id), false, 'the timed entry did not change');
});

function allDayColumn(ctx: TestContext, id: number): number {
  return (ctx.db.prepare('SELECT all_day FROM time_entries WHERE id = ?').get(id) as { all_day: number }).all_day;
}

test('an update turns an entry into a no-time entry and back', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { start: '2026-10-14T09:07:00Z', duration: 5000, description: 'review' });
  assertStored(ctx, entry.body, '2026-10-14T09:00:00+00:00', '2026-10-14T10:30:00+00:00');

  // Turning it on keeps the local date and the duration.
  const on = await ctx.json('PUT', `${url}/${entry.body.id}`, { all_day: true });
  assert.equal(on.status, 200);
  assertStored(ctx, on.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:30:00+00:00');
  assert.equal(on.body.all_day, true);
  assert.equal(on.body.description, 'review');
  assert.equal(allDayColumn(ctx, entry.body.id), 1);

  for (const body of [{}, { start: '2026-10-14T11:05:00Z' }, { stop: '2026-10-14T12:10:00Z' }]) {
    const refused = await ctx.json('PUT', `${url}/${entry.body.id}`, { all_day: false, ...body });
    assert.deepEqual([refused.status, refused.body], [400, 'Turning off all_day needs a start and a stop'], JSON.stringify(body));
  }
  assert.equal(allDayColumn(ctx, entry.body.id), 1);

  const off = await ctx.json('PUT', `${url}/${entry.body.id}`, { all_day: false, start: '2026-10-14T11:05:00Z', stop: '2026-10-14T12:10:00Z' });
  assert.equal(off.status, 200);
  assertStored(ctx, off.body, '2026-10-14T11:00:00+00:00', '2026-10-14T12:15:00+00:00');
  assert.equal(off.body.all_day, false);
  assert.equal(allDayColumn(ctx, entry.body.id), 0);

  // A start and a stop sent while turning it on give the day and the duration.
  const fromSpan = await ctx.json('PUT', `${url}/${entry.body.id}`, {
    all_day: true, start: '2026-10-15T08:10:00+02:00', stop: '2026-10-15T10:10:00+02:00',
  });
  assert.equal(fromSpan.status, 200);
  assertStored(ctx, fromSpan.body, '2026-10-14T22:00:00+00:00', '2026-10-15T00:00:00+00:00');

  const running = await ctx.json('POST', url, { start: '2026-10-16T09:00:00Z', duration: -1 });
  const refused = await ctx.json('PUT', `${url}/${running.body.id}`, { all_day: true });
  assert.deepEqual([refused.status, refused.body], [400, 'No-time entries can not be running']);
  assert.equal(runningCount(ctx), 1);
  assert.equal(allDayColumn(ctx, running.body.id), 0);
});

test('a no-time entry changes its date and duration but refuses a time of day', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 3600 });
  const id = entry.body.id;

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ start: '2026-10-14T09:00:00Z' }, 'No-time entries have no start time: change start_date or duration instead'],
    [{ start: '2026-10-14T00:00:00Z' }, 'No-time entries have no start time: change start_date or duration instead'],
    [{ stop: '2026-10-14T09:00:00Z' }, 'No-time entries have no end time: change duration instead'],
    [{ duration: 7200, stop: entry.body.stop }, 'No-time entries have no end time: change duration instead'],
    [{ duration: -1 }, 'No-time entries can not be running'],
    [{ duration: 90000 }, 'No-time entries can not be longer than 24 hours'],
  ];
  for (const [body, message] of cases) {
    const refused = await ctx.json('PUT', `${url}/${id}`, body);
    assert.deepEqual([refused.status, refused.body], [400, message], JSON.stringify(body));
  }
  const kept = await ctx.json('GET', `/api/v9/me/time_entries/${id}`);
  assertStored(ctx, kept.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:00:00+00:00');

  // A client that PUTs the whole entry back sends its own start and stop.
  const whole = await ctx.json('PUT', `${url}/${id}`, { ...entry.body, description: 'whole' });
  assert.equal(whole.status, 200);
  assertStored(ctx, whole.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:00:00+00:00');
  assert.equal(whole.body.description, 'whole');

  const moved = await ctx.json('PUT', `${url}/${id}`, { start_date: '2026-10-16', duration: 5000 });
  assert.equal(moved.status, 200);
  assertStored(ctx, moved.body, '2026-10-15T22:00:00+00:00', '2026-10-15T23:30:00+00:00');

  // Local midnight of another day moves the entry there.
  const byStart = await ctx.json('PUT', `${url}/${id}`, { start: '2026-10-17T00:00:00+02:00' });
  assert.equal(byStart.status, 200);
  assertStored(ctx, byStart.body, '2026-10-16T22:00:00+00:00', '2026-10-16T23:30:00+00:00');
  assert.equal(byStart.body.all_day, true);
});

test('a no-time entry stored off the grid keeps its span through edits that leave the day and duration alone', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 3600 });
  ctx.db.prepare('UPDATE time_entries SET stop = ? WHERE id = ?').run('2026-10-13T22:16:40.000Z', entry.body.id);

  const renamed = await ctx.json('PUT', `${url}/${entry.body.id}`, { description: 'renamed', billable: true, tags: ['old'] });
  assert.equal(renamed.status, 200);
  assertStored(ctx, renamed.body, '2026-10-13T22:00:00+00:00', '2026-10-13T22:16:40+00:00');
  assert.equal(renamed.body.description, 'renamed');

  const patched = await ctx.json('PATCH', `${url}/${entry.body.id}`, [{ op: 'replace', path: '/description', value: 'patched' }]);
  assert.deepEqual(patched.body.success, [entry.body.id]);
  const read = await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`);
  assertStored(ctx, read.body, '2026-10-13T22:00:00+00:00', '2026-10-13T22:16:40+00:00');

  const moved = await ctx.json('PUT', `${url}/${entry.body.id}`, { start_date: '2026-10-15' });
  assert.equal(moved.status, 200);
  assertStored(ctx, moved.body, '2026-10-14T22:00:00+00:00', '2026-10-14T22:15:00+00:00');
});

test('bulk PATCH refuses start and stop on a no-time entry and moves its duration', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  await setResolution(ctx, 15);
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const noTime = await ctx.json('POST', url, { all_day: true, start_date: '2026-10-14', duration: 3600 });
  const timed = await ctx.json('POST', url, { start: '2026-10-14T09:00:00Z', duration: 900 });

  for (const [path, value] of [['/start', '2026-10-14T08:00:00Z'], ['/stop', '2026-10-14T10:00:00Z']]) {
    const patched = await ctx.json('PATCH', `${url}/${noTime.body.id},${timed.body.id}`, [{ op: 'replace', path, value }]);
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body.success, [timed.body.id], path);
    assert.deepEqual(patched.body.failure, [{ id: noTime.body.id, message: 'No-time entries have no start or end time' }], path);
  }
  const kept = await ctx.json('GET', `/api/v9/me/time_entries/${noTime.body.id}`);
  assertStored(ctx, kept.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:00:00+00:00');

  const longer = await ctx.json('PATCH', `${url}/${noTime.body.id},${timed.body.id}`, [
    { op: 'replace', path: '/duration', value: 5000 },
  ]);
  assert.deepEqual(longer.body.success.sort(), [noTime.body.id, timed.body.id].sort());
  const after = await ctx.json('GET', `/api/v9/me/time_entries/${noTime.body.id}`);
  assertStored(ctx, after.body, '2026-10-13T22:00:00+00:00', '2026-10-13T23:30:00+00:00');
  assert.equal(after.body.all_day, true);

  const tooLong = await ctx.json('PATCH', `${url}/${noTime.body.id}`, [{ op: 'replace', path: '/duration', value: 90000 }]);
  assert.deepEqual(tooLong.body.failure, [{ id: noTime.body.id, message: 'No-time entries can not be longer than 24 hours' }]);
});
