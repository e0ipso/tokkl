import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { listTimeEntries, serializeTimeEntry } from './fixtures/domain.ts';
import { removeWorkspaceMember } from './fixtures/physical.ts';
import { setup, type TestContext } from './helpers.ts';

/** A user on an instance with a 1-minute resolution, so starts and stops keep their minute. */
async function timerSetup(): Promise<TestContext> {
  const ctx = await setup();
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 1 })).status, 200);
  return ctx;
}

const state = async (ctx: TestContext) => (await ctx.json<TimerState>('GET', '/api/app/timer')).body;

/** The user's live entries, oldest first, as the v9 API shows them. */
async function stored(ctx: TestContext) {
  return (await listTimeEntries(ctx.db, ctx.user.id)).reverse().map(row => {
    const { start, stop, description, workspace_id } = serializeTimeEntry(row);
    return { start, stop, description, workspace_id };
  });
}

test('start and stop answer the committed timer state with a new revision', async () => {
  const ctx = await timerSetup();
  const idle = await state(ctx);
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: idle.revision,
    description: 'Writing',
    start: '2026-10-14T09:00:00Z',
    created_with: 'test',
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.revision, idle.revision + 1);
  assert.equal(started.body.running_entry?.description, 'Writing');
  assert.equal(started.body.running_entry?.start, '2026-10-14T09:00:00+00:00');
  assert.equal(started.body.running_entry?.workspace_id, ctx.wid);
  const read = await state(ctx);
  assert.deepEqual({ ...read, server_time: null }, { ...started.body, server_time: null });

  const stopped = await ctx.json<TimerState>('POST', '/api/app/timer/stop', {
    revision: started.body.revision,
    stop: '2026-10-14T10:30:00Z',
  });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.revision, started.body.revision + 1);
  assert.equal(stopped.body.running_entry, null);
  assert.deepEqual(await stored(ctx), [
    {
      start: '2026-10-14T09:00:00+00:00',
      stop: '2026-10-14T10:30:00+00:00',
      description: 'Writing',
      workspace_id: ctx.wid,
    },
  ]);

  // Without a time, start and stop use now.
  const now = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: stopped.body.revision });
  assert.equal(now.status, 200);
  const startedAt = Date.parse(now.body.running_entry!.start);
  assert.ok(Math.abs(startedAt - Date.now()) < 60_000);
  const nowStopped = await ctx.json<TimerState>('POST', '/api/app/timer/stop', { revision: now.body.revision });
  assert.equal(nowStopped.status, 200);
  assert.equal(nowStopped.body.running_entry, null);
});

test('a start over a running timer stops it at the new start, like a v9 create', async () => {
  const ctx = await timerSetup();
  const first = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: 0,
    description: 'First',
    start: '2026-10-14T09:00:00Z',
  });
  assert.equal(first.status, 200);
  const second = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: first.body.revision,
    description: 'Second',
    start: '2026-10-14T09:45:00Z',
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.running_entry?.description, 'Second');
  assert.ok(second.body.revision > first.body.revision);
  assert.deepEqual(
    (await stored(ctx)).map(e => [e.description, e.start, e.stop]),
    [
      ['First', '2026-10-14T09:00:00+00:00', '2026-10-14T09:45:00+00:00'],
      ['Second', '2026-10-14T09:45:00+00:00', null],
    ],
  );
});

test('a start ends a pause chain, as a v9 create does', async () => {
  const ctx = await timerSetup();
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: 0, description: 'Chain' });
  const paused = await ctx.json<TimerState>('POST', '/api/app/timer/pause', {});
  assert.equal(paused.body.pause?.paused, true);
  assert.ok(paused.body.revision > started.body.revision);
  const fresh = await ctx.json<TimerState>('POST', '/api/app/timer/start', {
    revision: paused.body.revision,
    description: 'Fresh',
  });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.pause, null);
  assert.equal(fresh.body.running_entry?.description, 'Fresh');
});

test('a stale revision or a stop with nothing running gets 409 with the state and changes nothing', async () => {
  const ctx = await timerSetup();
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: 0, description: 'Kept' });
  assert.equal(started.status, 200);
  const before = await stored(ctx);

  const staleStart = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: 0, description: 'Late' });
  assert.equal(staleStart.status, 409);
  assert.equal(staleStart.body.revision, started.body.revision, 'the 409 body is the current state');
  assert.equal(staleStart.body.running_entry?.description, 'Kept');
  const staleStop = await ctx.json<TimerState>('POST', '/api/app/timer/stop', { revision: 0 });
  assert.equal(staleStop.status, 409);
  assert.equal(staleStop.body.revision, started.body.revision);
  assert.deepEqual(await stored(ctx), before);
  assert.equal((await state(ctx)).revision, started.body.revision);

  const stopped = await ctx.json<TimerState>('POST', '/api/app/timer/stop', { revision: started.body.revision });
  assert.equal(stopped.status, 200);
  const again = await ctx.json<TimerState>('POST', '/api/app/timer/stop', { revision: stopped.body.revision });
  assert.equal(again.status, 409);
  assert.equal(again.body.revision, stopped.body.revision);
  assert.equal(again.body.running_entry, null);
});

test('pause checks a revision when one is sent, and pauses without one as before', async () => {
  const ctx = await timerSetup();
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: 0, description: 'Kept' });
  const before = await stored(ctx);
  const stale = await ctx.json<TimerState>('POST', '/api/app/timer/pause', { revision: started.body.revision - 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, started.body.revision, 'the 409 body is the current state');
  assert.equal(stale.body.pause, null);
  assert.deepEqual(await stored(ctx), before, 'a stale pause stops nothing');
  for (const body of [{ revision: '1' }, { revision: 1.5 }, 'not an object'])
    assert.equal((await ctx.json('POST', '/api/app/timer/pause', body)).status, 400, JSON.stringify(body));

  const paused = await ctx.json<TimerState>('POST', '/api/app/timer/pause', { revision: started.body.revision });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.pause?.paused, true);
  // A body without a revision, or no body at all, pauses whatever runs.
  for (const body of [{}, { revision: null }, undefined]) {
    const resumed = await ctx.json<TimerState>('POST', '/api/app/timer/resume', {
      revision: (await state(ctx)).revision,
    });
    assert.equal(resumed.status, 200);
    const again = await ctx.json<TimerState>('POST', '/api/app/timer/pause', body);
    assert.equal(again.status, 200, JSON.stringify(body));
    assert.equal(again.body.pause?.paused, true);
  }
});

test('start and stop refuse a bad body with 400 before they read the timer', async () => {
  const ctx = await timerSetup();
  for (const [path, body] of [
    ['/api/app/timer/start', {}],
    ['/api/app/timer/start', { revision: '0' }],
    ['/api/app/timer/start', { revision: 0, start: '2026-10-14T09:00:00' }],
    ['/api/app/timer/start', { revision: 0, start: '2026-02-30T09:00:00Z' }],
    ['/api/app/timer/start', { revision: 0, workspace_id: 'x' }],
    ['/api/app/timer/stop', {}],
    ['/api/app/timer/stop', { revision: 0.5 }],
    ['/api/app/timer/stop', { revision: 0, stop: 1_700_000_000 }],
    ['/api/app/timer/stop', 'not an object'],
  ] as const) {
    const reply = await ctx.json('POST', path, body);
    assert.equal(reply.status, 400, `${path} ${JSON.stringify(body)}`);
  }
  const foreign = await ctx.json('POST', '/api/app/timer/start', { revision: 0, workspace_id: ctx.wid + 1000 });
  assert.equal(foreign.status, 403);
  assert.deepEqual(await stored(ctx), []);
});

test('stop refuses a user who is no longer a member of the running entry workspace, as v9 does', async () => {
  const ctx = await timerSetup();
  const idle = await state(ctx);
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: idle.revision });
  assert.equal(started.status, 200);
  assert.equal(await removeWorkspaceMember(ctx.db, ctx.wid, ctx.user.id), 1);

  const refused = await ctx.json('POST', '/api/app/timer/stop', { revision: started.body.revision });
  assert.equal(refused.status, 403);
  assert.equal(refused.body, 'User does not have access to this resource.');
  const v9 = await ctx.json(
    'PATCH',
    `/api/v9/workspaces/${ctx.wid}/time_entries/${started.body.running_entry!.id}/stop`,
  );
  assert.equal(v9.status, 403);
  assert.equal((await stored(ctx))[0]?.stop, null);
});
