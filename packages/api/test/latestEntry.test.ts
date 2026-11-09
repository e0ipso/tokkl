import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUser, setup, type TestContext } from './helpers.ts';
import { addWorkspaceMember, createWorkspace } from './fixtures/domain.ts';

const LATEST = '/api/app/time_entries/latest';

const create = async (ctx: TestContext, wid: number, body: Record<string, unknown>) => {
  const created = await ctx.json('POST', `/api/v9/workspaces/${wid}/time_entries`, {
    created_with: 'test',
    workspace_id: wid,
    ...body,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  return created.body as { id: number };
};

/** The first entry `/me/time_entries?meta=true` lists over every date. */
const firstListed = async (ctx: TestContext) => {
  const listed = await ctx.json('GET', '/api/v9/me/time_entries?meta=true&start_date=2000-01-01&end_date=2100-01-01');
  assert.equal(listed.status, 200);
  return listed.body[0] ?? null;
};

test('GET /api/app/time_entries/latest answers null for a user with no live entry', async () => {
  const ctx = await setup();
  const none = await ctx.json('GET', LATEST);
  assert.equal(none.status, 200);
  assert.equal(none.body, null);

  const only = await create(ctx, ctx.wid, { start: '2026-10-14T09:00:00Z', duration: 600 });
  assert.equal((await ctx.json('DELETE', `/api/v9/workspaces/${ctx.wid}/time_entries/${only.id}`)).status, 200);
  assert.equal((await ctx.json('GET', LATEST)).body, null, 'a trashed entry is not the latest');
});

test('GET /api/app/time_entries/latest is the newest entry by start in any workspace, as the list shows it', async () => {
  const ctx = await setup();
  const other = await addUser(ctx, { email: 'other@example.com', role: 'user' });
  const shared = await createWorkspace(ctx.db, 'Shared');
  await addWorkspaceMember(ctx.db, shared.id, ctx.user.id, 'owner');
  const project = await ctx.json('POST', `/api/v9/workspaces/${shared.id}/projects`, {
    name: 'Website',
    billable: true,
  });
  assert.equal(project.status, 200);

  await create(ctx, ctx.wid, { start: '2026-10-14T09:00:00Z', duration: 600, description: 'older' });
  // Created later but started earlier: the start decides, not the id.
  await create(ctx, ctx.wid, { start: '2026-10-13T09:00:00Z', duration: 600, description: 'oldest' });
  const newest = await create(ctx, shared.id, {
    start: '2026-10-15T09:00:00Z',
    duration: 600,
    description: 'newest',
    project_id: project.body.id,
  });
  await create(other, other.wid, { start: '2026-10-20T09:00:00Z', duration: 600, description: 'not mine' });

  const latest = await ctx.json('GET', LATEST);
  assert.equal(latest.status, 200);
  assert.equal(latest.body.id, newest.id);
  assert.equal(latest.body.wid, shared.id);
  assert.equal(latest.body.project_active, true);
  assert.equal(latest.body.project_billable, true);
  assert.deepEqual(latest.body, await firstListed(ctx), 'the shape and fields of the meta list item');

  // A running entry that started later is the latest; on a tie of starts the higher id wins.
  const running = await create(ctx, ctx.wid, { start: '2026-10-16T09:00:00Z', duration: -1, description: 'running' });
  assert.equal((await ctx.json('GET', LATEST)).body.id, running.id);
  assert.equal((await ctx.json('GET', LATEST)).body.stop, null);
  const tied = await create(ctx, ctx.wid, { start: '2026-10-16T09:00:00Z', duration: 600, description: 'tied' });
  assert.equal((await ctx.json('GET', LATEST)).body.id, tied.id);
  assert.deepEqual((await ctx.json('GET', LATEST)).body, await firstListed(ctx));

  assert.equal((await other.json('GET', LATEST)).body.description, 'not mine');
});

test('GET /api/app/time_entries/latest needs a signed-in user', async () => {
  const ctx = await setup();
  assert.equal((await ctx.request('GET', LATEST, undefined, { authorization: '' })).status, 403);
});
