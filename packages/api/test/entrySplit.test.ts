import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageFor } from './fixtures/database.ts';
import { addUser, setup, type TestContext } from './helpers.ts';

type Entry = Record<string, unknown> & { id: number; start: string; stop: string | null; tags: string[] };

async function entryWith(ctx: TestContext, body: Record<string, unknown>): Promise<Entry> {
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries?meta=true`, {
    created_with: 'test',
    ...body,
  });
  assert.equal(created.status, 200);
  return created.body;
}

const liveCount = async (ctx: TestContext) => (await storageFor(ctx.db).entries.list(ctx.user.id)).length;

/** Without the ids and write times that differ per run. */
function shown({ id: _id, at: _at, ...fields }: Entry) {
  return fields;
}

test('a split answers the same two entries the client used to write with a create and an edit', async () => {
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 15 })).status, 200);
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Alpha', billable: true });
  const task = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects/${project.body.id}/tasks`, {
    name: 'Review',
  });
  const fields = {
    description: 'Pairing',
    project_id: project.body.id,
    task_id: task.body.id,
    tags: ['b', 'a'],
    billable: false,
    start: '2026-10-14T08:00:00Z',
    stop: '2026-10-14T09:15:00Z',
  };
  const split = await entryWith(ctx, fields);
  const manual = await entryWith(ctx, fields);

  const cut = '2026-10-14T08:30:00.000Z';
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries?meta=true`, {
    created_with: 'tokkl-web',
    description: manual.description,
    project_id: manual.project_id,
    task_id: manual.task_id,
    tags: manual.tags,
    billable: manual.billable,
    start: cut,
    stop: manual.stop,
  });
  const edited = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${manual.id}?meta=true`, {
    start: manual.start,
    stop: cut,
  });

  // A split time of 8:37 moves to the grid point at 8:30, as the client previews it.
  const reply = await ctx.json('POST', `/api/app/time_entries/${split.id}/split`, {
    at: '2026-10-14T08:37:00Z',
    created_with: 'tokkl-web',
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.first.id, split.id);
  assert.deepEqual(shown(reply.body.first), shown(edited.body));
  assert.deepEqual(shown(reply.body.second), shown(created.body));
  assert.deepEqual(
    [reply.body.first.start, reply.body.first.stop],
    ['2026-10-14T08:00:00+00:00', '2026-10-14T08:30:00+00:00'],
  );
  assert.deepEqual(
    [reply.body.second.start, reply.body.second.stop],
    ['2026-10-14T08:30:00+00:00', '2026-10-14T09:15:00+00:00'],
  );
  const listed = await ctx.json('GET', `/api/v9/me/time_entries/${reply.body.second.id}?meta=true`);
  assert.deepEqual(shown(listed.body), shown(reply.body.second));
  const rows = storageFor(ctx.db).entries;
  assert.equal((await rows.get(ctx.user.id, reply.body.second.id))?.createdWith, 'tokkl-web');
  assert.equal((await rows.get(ctx.user.id, created.body.id))?.createdWith, 'tokkl-web');
});

test('a refused split changes nothing', async () => {
  const ctx = await setup();
  const other = await addUser(ctx, { email: 'other@example.com', role: 'user' });
  const stopped = await entryWith(ctx, {
    description: 'Done',
    start: '2026-10-14T08:00:00Z',
    stop: '2026-10-14T09:00:00Z',
  });
  const noTime = await entryWith(ctx, {
    description: 'Admin',
    all_day: true,
    start_date: '2026-10-13',
    duration: 3600,
  });
  const running = await entryWith(ctx, { description: 'Now', start: '2026-10-14T10:00:00Z', duration: -1 });
  const trashed = await entryWith(ctx, {
    description: 'Gone',
    start: '2026-10-12T08:00:00Z',
    stop: '2026-10-12T09:00:00Z',
  });
  assert.equal((await ctx.json('DELETE', `/api/v9/workspaces/${ctx.wid}/time_entries/${trashed.id}`)).status, 200);
  const count = await liveCount(ctx);
  const at = (value: string) => ({ at: value });
  const cases: Array<[string, unknown, number, string]> = [
    [
      `/api/app/time_entries/${stopped.id}/split`,
      at('2026-10-14T08:02:00Z'),
      400,
      'The split time must fall inside the entry',
    ],
    [
      `/api/app/time_entries/${stopped.id}/split`,
      at('2026-10-14T08:58:00Z'),
      400,
      'The split time must fall inside the entry',
    ],
    [
      `/api/app/time_entries/${stopped.id}/split`,
      at('2026-10-14T07:00:00Z'),
      400,
      'The split time must fall inside the entry',
    ],
    [`/api/app/time_entries/${stopped.id}/split`, at('8:30'), 400, 'Invalid at: expected an RFC 3339 timestamp'],
    [`/api/app/time_entries/${stopped.id}/split`, {}, 400, 'Invalid at: expected an RFC 3339 timestamp'],
    [
      `/api/app/time_entries/${noTime.id}/split`,
      at('2026-10-13T00:30:00Z'),
      400,
      'No-time entries have no start or end time',
    ],
    [
      `/api/app/time_entries/${running.id}/split`,
      at('2026-10-14T10:05:00Z'),
      409,
      'A running time entry can not be split',
    ],
    [`/api/app/time_entries/${trashed.id}/split`, at('2026-10-12T08:30:00Z'), 404, 'Time entry not found'],
    [`/api/app/time_entries/${stopped.id + 1000}/split`, at('2026-10-14T08:30:00Z'), 404, 'Time entry not found'],
  ];
  for (const [path, body, status, message] of cases) {
    const reply = await ctx.json('POST', path, body);
    assert.deepEqual([reply.status, reply.body], [status, message], path);
  }
  const theirs = await other.json('POST', `/api/app/time_entries/${stopped.id}/split`, at('2026-10-14T08:30:00Z'));
  assert.deepEqual([theirs.status, theirs.body], [404, 'Time entry not found']);
  assert.equal(await liveCount(ctx), count);
  const kept = await ctx.json('GET', `/api/v9/me/time_entries/${stopped.id}`);
  assert.deepEqual([kept.body.start, kept.body.stop], ['2026-10-14T08:00:00+00:00', '2026-10-14T09:00:00+00:00']);
});
