/**
 * A user who left the entry's workspace may not stop or change it through any timer path; each refusal is the
 * v9 403 and rolls the action back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { addWorkspaceMember, listTimeEntries, serializeTimeEntry } from './fixtures/domain.ts';
import { removeWorkspaceMember } from './fixtures/physical.ts';
import { addUser, setup, type TestContext, timerState as state } from './helpers.ts';

const NO_ACCESS = 'User does not have access to this resource.';

interface LeftContext extends TestContext {
  other: number;
}

/** `begin` runs while the user is still a member of its own workspace; then that membership ends. */
async function leaving(begin: (ctx: LeftContext) => Promise<void>): Promise<LeftContext> {
  const ctx = await setup();
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 1 })).status, 200);
  const bob = await addUser(ctx, { email: 'bob@example.com', role: 'user' });
  await addWorkspaceMember(ctx.db, bob.wid, ctx.user.id, 'member');
  const left = { ...ctx, other: bob.wid };
  await begin(left);
  assert.equal(await removeWorkspaceMember(ctx.db, ctx.wid, ctx.user.id), 1);
  return left;
}

const entries = async (ctx: TestContext) =>
  (await listTimeEntries(ctx.db, ctx.user.id)).map(row => serializeTimeEntry(row));

async function assertRefused(ctx: TestContext, method: string, path: string, body?: unknown): Promise<void> {
  const before = { timer: await state(ctx), entries: await entries(ctx) };
  const reply = await ctx.json(method, path, body);
  assert.equal(reply.status, 403, `${method} ${path}`);
  assert.equal(reply.body, NO_ACCESS, `${method} ${path}`);
  const after = { timer: await state(ctx), entries: await entries(ctx) };
  assert.deepEqual(
    { ...after, timer: { ...after.timer, server_time: null } },
    { ...before, timer: { ...before.timer, server_time: null } },
    `${method} ${path} changed nothing`,
  );
}

async function startTimer(ctx: TestContext): Promise<void> {
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: (await state(ctx)).revision,
    description: 'Kept',
  });
  assert.equal(started.status, 200);
}

async function startSession(ctx: TestContext): Promise<void> {
  const started = await ctx.json<TimerState>('POST', '/api/app/pomodoro', { description: 'Focus' });
  assert.equal(started.status, 200);
}

test('pause refuses a running entry in a workspace the user left', async () => {
  const ctx = await leaving(startTimer);
  await assertRefused(ctx, 'POST', '/api/app/timer/pause');
  assert.equal((await state(ctx)).pause, null);
});

test('End session and Next phase refuse a pomodoro in a workspace the user left', async () => {
  const ctx = await leaving(startSession);
  const { revision } = await state(ctx);
  await assertRefused(ctx, 'POST', '/api/app/pomodoro/end', { revision });
  assert.equal((await state(ctx)).pomodoro?.phase.kind, 'work');

  // Rest to work stops the open pomodoro and starts a copy: refused. Work to rest stops nothing.
  const rest = await ctx.json<TimerState>('POST', '/api/app/pomodoro/next', { revision });
  assert.equal(rest.status, 200);
  assert.equal(rest.body.pomodoro?.phase.kind, 'shortRest');
  await assertRefused(ctx, 'POST', '/api/app/pomodoro/next', { revision: rest.body.revision });
});

test('a start elsewhere refuses to stop a running entry in a workspace the user left', async () => {
  const ctx = await leaving(startTimer);
  const { revision } = await state(ctx);
  await assertRefused(ctx, 'POST', '/api/app/timer/start', { revision, workspace_id: ctx.other });
  await assertRefused(ctx, 'POST', '/api/app/pomodoro', { revision, workspace_id: ctx.other });
  await assertRefused(ctx, 'POST', `/api/v9/workspaces/${ctx.other}/time_entries`, {
    workspace_id: ctx.other,
    start: new Date().toISOString(),
    duration: -1,
  });

  // An edit that makes a stopped entry run stops the running one too.
  const stopped = await ctx.json('POST', `/api/v9/workspaces/${ctx.other}/time_entries`, {
    workspace_id: ctx.other,
    start: '2026-10-14T09:00:00Z',
    duration: 600,
  });
  assert.equal(stopped.status, 200);
  await assertRefused(ctx, 'PUT', `/api/v9/workspaces/${ctx.other}/time_entries/${stopped.body.id}`, {
    duration: -1,
  });
});

test('a session start refuses to end a pause chain over an entry in a workspace the user left', async () => {
  const ctx = await leaving(async ctx => {
    await startTimer(ctx);
    const resumed = await ctx.json<TimerState>('POST', '/api/app/timer/resume', {
      revision: (await ctx.json<TimerState>('POST', '/api/app/timer/pause')).body.revision,
    });
    assert.equal(resumed.status, 200);
  });
  await assertRefused(ctx, 'POST', '/api/app/pomodoro', { workspace_id: ctx.other });
  assert.notEqual((await state(ctx)).pause, null);
});

test('resume refuses a paused chain in a workspace the user left; discard still ends it', async () => {
  const ctx = await leaving(async ctx => {
    await startTimer(ctx);
    assert.equal((await ctx.json('POST', '/api/app/timer/pause')).status, 200);
  });
  const { revision } = await state(ctx);
  await assertRefused(ctx, 'POST', '/api/app/timer/resume', { revision });
  // Discard drops the chain and touches no entry, so a user who left can still clear it.
  const discarded = await ctx.json<TimerState>('POST', '/api/app/timer/discard', { revision });
  assert.equal(discarded.status, 200);
  assert.equal(discarded.body.pause, null);
});
