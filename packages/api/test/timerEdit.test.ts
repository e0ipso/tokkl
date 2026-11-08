import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { removeWorkspaceMember } from './fixtures/physical.ts';
import { addUser, setup, type TestContext } from './helpers.ts';

const state = async (ctx: TestContext) => (await ctx.json<TimerState>('GET', '/api/app/timer')).body;
const edit = (ctx: TestContext, body: unknown) => ctx.json<TimerState>('POST', '/api/app/timer/edit', body);
/** `state` without the instant it was read at, so two reads of one revision compare equal. */
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
  ]) {
    const v9 = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${id}`, body);
    const app = await edit(ctx, { revision: started.revision, ...body });
    assert.ok(v9.status >= 400, `v9 refuses ${JSON.stringify(body)}`);
    assert.deepEqual([app.status, app.body], [v9.status, v9.body], JSON.stringify(body));
  }
  for (const body of [{}, { revision: '1' }, 'not an object']) {
    const reply = await edit(ctx, body);
    assert.equal(reply.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(timeless(await state(ctx)), timeless(started));
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
