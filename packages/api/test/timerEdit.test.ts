import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { removeWorkspaceMember } from './fixtures/physical.ts';
import { addUser, setup, type TestContext, timerState as state } from './helpers.ts';

const edit = (ctx: TestContext, body: unknown) => ctx.json<TimerState>('POST', '/api/app/timer/edit', body);
/** So two reads of one revision compare equal. */
const timeless = (s: TimerState) => ({ ...s, server_time: null });

async function running(ctx: TestContext): Promise<TimerState> {
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: (await state(ctx)).revision,
    description: 'Draft',
    start: '2026-10-14T09:00:00Z',
  });
  assert.equal(started.status, 200);
  return started.body;
}

test('an edit changes the running entry labels and answers the next revision', async () => {
  const ctx = await setup();
  const before = await running(ctx);
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Site', billable: true });
  assert.equal(project.status, 200);

  const edited = await edit(ctx, {
    revision: before.revision,
    description: 'Final',
    project_id: project.body.id,
    tags: ['review'],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, before.revision + 1);
  const entry = edited.body.running_entry!;
  assert.equal(entry.id, before.running_entry!.id);
  assert.equal(entry.start, before.running_entry!.start, 'the times stay');
  assert.equal(entry.stop, null);
  assert.equal(entry.description, 'Final');
  assert.equal(entry.project_id, project.body.id);
  assert.equal(entry.billable, true, 'a new project brings its billable flag, as in a v9 edit');
  assert.deepEqual(entry.tags, ['review']);
  assert.deepEqual(timeless(await state(ctx)), timeless(edited.body));

  const unbilled = await edit(ctx, { revision: edited.body.revision, billable: false });
  assert.equal(unbilled.status, 200);
  assert.equal(unbilled.body.running_entry?.billable, false);
  assert.equal(unbilled.body.running_entry?.description, 'Final', 'fields left out stay');
  const v9 = await ctx.json('GET', `/api/v9/me/time_entries/${entry.id}`);
  assert.equal(v9.body.billable, false);
});

test('an edit on a stale revision or with nothing running gets 409 with the state', async () => {
  const ctx = await setup();
  const idle = await state(ctx);
  const nothing = await edit(ctx, { revision: idle.revision, billable: true });
  assert.equal(nothing.status, 409);
  assert.deepEqual(timeless(nothing.body), timeless(idle));

  const started = await running(ctx);
  const stale = await edit(ctx, { revision: idle.revision, description: 'Late' });
  assert.equal(stale.status, 409);
  assert.deepEqual(timeless(stale.body), timeless(started));
  assert.deepEqual(timeless(await state(ctx)), timeless(started));
});

test('an edit refuses what a v9 edit of the running entry refuses, with the same reply', async () => {
  const ctx = await setup();
  const started = await running(ctx);
  const id = started.running_entry!.id;
  const bob = await addUser(ctx, { email: 'bob@example.com', role: 'user' });
  const foreign = await bob.json('POST', `/api/v9/workspaces/${bob.wid}/projects`, { name: 'Theirs' });
  assert.equal(foreign.status, 200);

  for (const body of [
    { billable: 'yes' },
    { description: 7 },
    { project_id: foreign.body.id },
    { project_id: 'x' },
    { tag_ids: [999] },
    { tags: 'review' },
    { start: 'x' },
    { start: '2026-10-14T08:00:00' },
    { start: '2026-02-30T08:00:00Z' },
  ]) {
    const v9 = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${id}`, body);
    const app = await edit(ctx, { revision: started.revision, ...body });
    assert.ok(v9.status >= 400, `v9 refuses ${JSON.stringify(body)}`);
    assert.deepEqual([app.status, app.body], [v9.status, v9.body], JSON.stringify(body));
  }
  for (const body of [
    {},
    { revision: '1' },
    'not an object',
    { entry_id: '1' },
    { entry_id: 0 },
    { entry_id: id, revision: 'x' },
  ]) {
    const reply = await edit(ctx, body);
    assert.equal(reply.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(timeless(await state(ctx)), timeless(started));
});

test('an edit naming the running entry survives an unrelated change that a revision would refuse', async () => {
  const ctx = await setup();
  const project = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Site' });
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: (await state(ctx)).revision,
    description: 'Draft',
    project_id: project.body.id,
  });
  const id = started.body.running_entry!.id;
  await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/projects/${project.body.id}`, { name: 'Website' });
  const moved = await state(ctx);
  assert.ok(moved.revision > started.body.revision);

  const stale = await edit(ctx, { revision: started.body.revision, description: 'Late' });
  assert.equal(stale.status, 409);
  const edited = await edit(ctx, { entry_id: id, description: 'Final' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.running_entry?.id, id);
  assert.equal(edited.body.running_entry?.description, 'Final');
  assert.equal(edited.body.revision, moved.revision + 1);
  const both = await edit(ctx, { entry_id: id, revision: moved.revision, description: 'Both' });
  assert.equal(both.status, 409);
  assert.equal((await edit(ctx, { entry_id: id, revision: edited.body.revision, billable: true })).status, 200);
});

test('an edit naming an entry that no longer runs gets 409 with the state and changes nothing', async () => {
  const ctx = await setup();
  const first = await running(ctx);
  const firstId = first.running_entry!.id;
  const stopped = await ctx.json<TimerState>('POST', '/api/app/timer/stop', { revision: first.revision });
  const idle = await edit(ctx, { entry_id: firstId, description: 'Gone' });
  assert.equal(idle.status, 409);
  assert.deepEqual(timeless(idle.body), timeless(stopped.body));

  const second = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: stopped.body.revision,
    description: 'Second',
  });
  const refused = await edit(ctx, { entry_id: firstId, description: 'Wrong entry' });
  assert.equal(refused.status, 409);
  assert.deepEqual(timeless(refused.body), timeless(second.body));
  assert.equal((await ctx.json('GET', `/api/v9/me/time_entries/${firstId}`)).body.description, 'Draft');
  assert.deepEqual(timeless(await state(ctx)), timeless(second.body));
});

test('an edit moves the running entry start the way a v9 edit of it does', async () => {
  const ctx = await setup();
  const started = await running(ctx);
  const id = started.running_entry!.id;
  const edited = await edit(ctx, { entry_id: id, start: '2026-10-14T08:30:00Z', description: 'Earlier' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.running_entry?.start, '2026-10-14T08:30:00+00:00');
  assert.equal(edited.body.running_entry?.stop, null, 'the entry keeps running');
  assert.equal(edited.body.running_entry?.description, 'Earlier');
  const v9 = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${id}`, {
    start: '2026-10-14T08:15:00Z',
  });
  const app = await edit(ctx, { revision: (await state(ctx)).revision, start: '2026-10-14T08:15:00Z' });
  assert.equal(app.status, 200);
  assert.equal(app.body.running_entry?.start, v9.body.start, 'both land on the same start');
});

test('an edit refuses a running entry in a workspace the user left, as v9 does', async () => {
  const ctx = await setup();
  const started = await running(ctx);
  assert.equal(await removeWorkspaceMember(ctx.db, ctx.wid, ctx.user.id), 1);
  const refused = await edit(ctx, { revision: started.revision, billable: true });
  assert.equal(refused.status, 403);
  assert.equal(refused.body, 'User does not have access to this resource.');
  assert.deepEqual(timeless(await state(ctx)), timeless(started));
});
