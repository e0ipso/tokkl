import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerApi, ServerCapability } from '@tokkl/types';
import { setup, type TestContext } from './helpers.ts';

/** A request that only a server with the capability answers with something other than 404. */
const PROBES: Record<ServerCapability, (ctx: TestContext) => Promise<number>> = {
  'app-preferences': async ctx => (await ctx.json('GET', '/api/app/me/preferences')).status,
  'timer-actions': async ctx => (await ctx.json('POST', '/api/app/timer/stop', { revision: 0 })).status,
  'timer-edit': async ctx => (await ctx.json('POST', '/api/app/timer/edit', { revision: 0, billable: true })).status,
  // A stale revision is refused only by a server that checks it.
  'pomodoro-revision': async ctx => (await ctx.json('POST', '/api/app/pomodoro', { revision: -1 })).status,
};

test('GET /api/v9/me names the API version and the capabilities this server has', async () => {
  const ctx = await setup();
  const me = await ctx.json<ServerApi>('GET', '/api/v9/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.api_version, 1);
  assert.deepEqual(me.body.capabilities, ['app-preferences', 'timer-actions', 'timer-edit', 'pomodoro-revision']);
  const related = await ctx.json<ServerApi>('GET', '/api/v9/me?with_related_data=true');
  assert.deepEqual([related.body.api_version, related.body.capabilities], [1, me.body.capabilities]);

  const answered: Record<string, number> = {};
  for (const name of me.body.capabilities) answered[name] = await PROBES[name](ctx);
  assert.deepEqual(answered, {
    'app-preferences': 200,
    'timer-actions': 409,
    'timer-edit': 409,
    'pomodoro-revision': 409,
  });
});
