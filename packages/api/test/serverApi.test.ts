import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppStatus, ServerApi, ServerCapability, TimerState } from '@tokkl/types';
import { SERVER_API, setup, type TestContext } from './helpers.ts';
import { OPTIONAL_REVISION_ACTIONS } from '../src/commands/timers.ts';

/**
 * A request whose status tells a server with the capability from one without it: a 404 for a
 * missing route, or the answer an older server gives a body it does not know.
 */
const PROBES: Record<ServerCapability, (ctx: TestContext) => Promise<number>> = {
  'app-preferences': async ctx => (await ctx.json('GET', '/api/app/me/preferences')).status,
  'timer-actions': async ctx => (await ctx.json('POST', '/api/app/timer/stop', { revision: 0 })).status,
  'timer-edit': async ctx => (await ctx.json('POST', '/api/app/timer/edit', { revision: 0, billable: true })).status,
  // A stale revision is refused only by a server that checks it.
  'pomodoro-revision': async ctx => (await ctx.json('POST', '/api/app/pomodoro', { revision: -1 })).status,
  // An older server pauses a running timer whatever the body says.
  'pause-revision': async ctx => {
    const { revision } = (await ctx.json('GET', '/api/app/timer')).body;
    assert.equal((await ctx.json('POST', '/api/app/timer/start', { revision, description: 'probe' })).status, 200);
    return (await ctx.json('POST', '/api/app/timer/pause', { revision: -1 })).status;
  },
  // An older server refuses an edit without a revision as invalid input.
  // An older server ignores the key and refuses the second tag as a duplicate name.
  'idempotency-keys': async ctx => {
    const tag = () =>
      ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/tags`, { name: 'probe' }, { 'Idempotency-Key': 'p' });
    assert.equal((await tag()).status, 200);
    return (await tag()).status;
  },
  'timer-edit-entry': async ctx =>
    (await ctx.json('POST', '/api/app/timer/edit', { entry_id: 999_999, billable: true })).status,
};

test('GET /api/app/status names the API version and the capabilities this server has', async () => {
  const ctx = await setup();
  const status = await ctx.json<ServerApi & { setup_required: boolean }>('GET', '/api/app/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.setup_required, false);
  assert.equal(status.body.api_version, 1);
  assert.deepEqual(status.body.capabilities, [
    'app-preferences',
    'timer-actions',
    'timer-edit',
    'pomodoro-revision',
    'pause-revision',
    'timer-edit-entry',
    'idempotency-keys',
  ]);
  const me = await ctx.json<Record<string, unknown>>('GET', '/api/v9/me');
  assert.equal('api_version' in me.body || 'capabilities' in me.body, false, 'the Toggl /me body stays as it was');
  const related = await ctx.json<Record<string, unknown>>('GET', '/api/v9/me?with_related_data=true');
  assert.equal('api_version' in related.body || 'capabilities' in related.body, false);

  const answered: Record<string, number> = {};
  for (const name of status.body.capabilities) answered[name] = await PROBES[name](ctx);
  assert.deepEqual(answered, {
    'app-preferences': 200,
    'timer-actions': 409,
    'timer-edit': 409,
    'pomodoro-revision': 409,
    'pause-revision': 409,
    'timer-edit-entry': 409,
    'idempotency-keys': 200,
  });
});

test('GET /api/app/status names the Pomodoro limits a session start enforces', async () => {
  const ctx = await setup();
  const { pomodoro_limits: limits } = (await ctx.json<AppStatus>('GET', '/api/app/status')).body;
  assert.deepEqual(limits, SERVER_API.pomodoro_limits);
  for (const [field, { min, max }] of Object.entries(limits)) {
    for (const value of [min - 1, max + 1]) {
      const refused = await ctx.json('POST', '/api/app/pomodoro', { [field]: value });
      assert.equal(refused.status, 400, `${field} ${value}`);
      assert.equal(refused.body, `Invalid ${field}: expected an integer from ${min} to ${max}`);
    }
    for (const value of [min, max]) {
      const started = await ctx.json<TimerState>('POST', '/api/app/pomodoro', { [field]: value });
      assert.equal(started.status, 200, `${field} ${value}`);
      await ctx.json('POST', '/api/app/pomodoro/end', { revision: started.body.revision });
    }
  }
  // A new account starts from the defaults.
  const { body: idle } = await ctx.json<TimerState>('GET', '/api/app/timer');
  const session = await ctx.json<TimerState>('POST', '/api/app/pomodoro', { revision: idle.revision });
  const pomodoro = session.body.pomodoro!;
  assert.deepEqual(
    [pomodoro.work_minutes, pomodoro.short_rest_minutes, pomodoro.long_rest_minutes, pomodoro.long_rest_every],
    [
      limits.work_minutes.default,
      limits.short_rest_minutes.default,
      limits.long_rest_minutes.default,
      limits.long_rest_every.default,
    ],
  );
});

test('only the actions listed as optional-revision act without a revision, each behind an announced capability', async () => {
  const ctx = await setup();
  const { capabilities } = (await ctx.json<AppStatus>('GET', '/api/app/status')).body;
  for (const capability of Object.values(OPTIONAL_REVISION_ACTIONS)) assert.ok(capabilities.includes(capability));
  const started = await ctx.json<TimerState>('POST', '/api/app/timer/start', { revision: 0, description: 'Run' });
  assert.equal(started.status, 200);
  // Each revisioned action that is not listed refuses a body without a revision before it reads the timer.
  for (const path of [
    '/api/app/timer/start',
    '/api/app/timer/stop',
    '/api/app/timer/edit',
    '/api/app/timer/resume',
    '/api/app/timer/discard',
    '/api/app/pomodoro/next',
    '/api/app/pomodoro/end',
  ]) {
    assert.equal(`POST ${path}` in OPTIONAL_REVISION_ACTIONS, false, path);
    assert.equal((await ctx.json('POST', path, {})).status, 400, path);
  }
  // The listed ones act on whatever runs.
  const listed = Object.keys(OPTIONAL_REVISION_ACTIONS).sort();
  assert.deepEqual(listed, ['POST /api/app/pomodoro', 'POST /api/app/timer/pause']);
  assert.equal((await ctx.json('POST', '/api/app/timer/pause', {})).status, 200);
  assert.equal((await ctx.json('POST', '/api/app/pomodoro', {})).status, 200);
});
