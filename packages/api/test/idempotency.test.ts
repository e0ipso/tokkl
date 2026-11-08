import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { listDeletedEntries, listTimeEntries } from './fixtures/domain.ts';
import { corruptRecord } from './fixtures/physical.ts';
import { addUser, setup, type TestContext } from './helpers.ts';
import { IDEMPOTENCY_RETENTION_MS } from '../src/domain/idempotency.ts';

interface Reply {
  status: number;
  body: any;
}

async function send(ctx: TestContext, path: string, body: unknown, key?: string): Promise<Reply> {
  const response = await ctx.request('POST', path, body, key === undefined ? {} : { 'Idempotency-Key': key });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Entries made, those a later stop sent to the trash included. */
const entryCount = async (ctx: TestContext) =>
  (await listTimeEntries(ctx.db, ctx.user.id)).length + (await listDeletedEntries(ctx.db, ctx.user.id)).length;
const listed = async (ctx: TestContext, path: string) => ((await ctx.json('GET', path)).body as unknown[]).length;
/** A timer reply without the instant it was read at, so two reads of one revision compare equal. */
const timeless = (state: TimerState) => ({ ...state, server_time: null });

/** One create that takes a key: where it goes, a body, another body, and how many records it made. */
interface Create {
  name: string;
  prepare?: (ctx: TestContext) => Promise<void>;
  path: (ctx: TestContext) => string;
  body: (ctx: TestContext) => Promise<unknown>;
  other: (ctx: TestContext) => Promise<unknown>;
  count: (ctx: TestContext) => Promise<number>;
  /** The part of the reply a repeat must give back unchanged. */
  result: (body: any) => unknown;
}

const ws = (ctx: TestContext) => `/api/v9/workspaces/${ctx.wid}`;
const revision = async (ctx: TestContext) => (await ctx.json<TimerState>('GET', '/api/app/timer')).body.revision;
let projectId = 0;
let splitId = 0;

const CREATES: Create[] = [
  {
    name: 'v9 time entry',
    path: ctx => `${ws(ctx)}/time_entries`,
    body: async ctx => ({ description: 'Once', start: '2026-10-14T09:00:00Z', duration: 600, workspace_id: ctx.wid }),
    other: async ctx => ({ description: 'Twice', start: '2026-10-14T09:00:00Z', duration: 600, workspace_id: ctx.wid }),
    count: entryCount,
    result: body => body,
  },
  {
    name: 'timer start',
    path: () => '/api/app/timer/start',
    body: async ctx => ({ revision: await revision(ctx), description: 'Timer' }),
    other: async ctx => ({ revision: await revision(ctx), description: 'Other timer' }),
    count: entryCount,
    result: timeless,
  },
  {
    name: 'Pomodoro start',
    path: () => '/api/app/pomodoro',
    body: async ctx => ({ revision: await revision(ctx), description: 'Focus' }),
    other: async ctx => ({ revision: await revision(ctx), description: 'Other focus' }),
    count: entryCount,
    result: timeless,
  },
  {
    name: 'entry split',
    async prepare(ctx) {
      const body = { start: '2026-10-14T10:00:00Z', duration: 3600, workspace_id: ctx.wid, description: 'Whole' };
      splitId = (await ctx.json('POST', `${ws(ctx)}/time_entries`, body)).body.id;
    },
    path: () => `/api/app/time_entries/${splitId}/split`,
    body: async () => ({ at: '2026-10-14T10:20:00Z' }),
    other: async () => ({ at: '2026-10-14T10:10:00Z' }),
    count: entryCount,
    result: body => body,
  },
  {
    name: 'client',
    path: ctx => `${ws(ctx)}/clients`,
    body: async () => ({ name: 'Acme' }),
    other: async () => ({ name: 'Initech' }),
    count: ctx => listed(ctx, `${ws(ctx)}/clients?status=both`),
    result: body => body,
  },
  {
    name: 'project',
    path: ctx => `${ws(ctx)}/projects`,
    body: async () => ({ name: 'Site' }),
    other: async () => ({ name: 'App' }),
    count: ctx => listed(ctx, `${ws(ctx)}/projects?active=both`),
    result: body => body,
  },
  {
    name: 'task',
    async prepare(ctx) {
      projectId = (await ctx.json('POST', `${ws(ctx)}/projects`, { name: 'Tasks' })).body.id;
    },
    path: ctx => `${ws(ctx)}/projects/${projectId}/tasks`,
    body: async () => ({ name: 'Copy' }),
    other: async () => ({ name: 'Layout' }),
    count: ctx => listed(ctx, `${ws(ctx)}/projects/${projectId}/tasks`),
    result: body => body,
  },
  {
    name: 'tag',
    path: ctx => `${ws(ctx)}/tags`,
    body: async () => ({ name: 'urgent' }),
    other: async () => ({ name: 'later' }),
    count: ctx => listed(ctx, `${ws(ctx)}/tags`),
    result: body => body,
  },
];

for (const create of CREATES) {
  test(`${create.name}: a repeated key answers the first result, and a different request with it gets 422`, async () => {
    const ctx = await setup();
    await create.prepare?.(ctx);
    const body = await create.body(ctx);
    const before = await create.count(ctx);
    const first = await send(ctx, create.path(ctx), body, 'key-1');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const made = await create.count(ctx);
    assert.ok(made > before, 'the first request creates');

    const again = await send(ctx, create.path(ctx), body, 'key-1');
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(create.result(again.body), create.result(first.body));
    assert.equal(await create.count(ctx), made, 'the repeat creates nothing');

    const other = await send(ctx, create.path(ctx), await create.other(ctx), 'key-1');
    assert.equal(other.status, 422);
    assert.equal(other.body, 'This Idempotency-Key was already used with a different request');
    assert.equal(await create.count(ctx), made);

    // A new key is a new request. A second Pomodoro session cannot start while one runs.
    if (create.name === 'Pomodoro start') return;
    const fresh = await send(ctx, create.path(ctx), await create.other(ctx), 'key-2');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.ok((await create.count(ctx)) > made);
  });
}

test('the same body in another key order is the same request', async () => {
  const ctx = await setup();
  const path = `${ws(ctx)}/time_entries`;
  const wid = `"workspace_id":${ctx.wid}`;
  const first = await send(
    ctx,
    path,
    `{"description":"Order","duration":600,"start":"2026-10-14T09:00:00Z",${wid}}`,
    'k',
  );
  const again = await send(
    ctx,
    path,
    `{${wid},"start":"2026-10-14T09:00:00Z","duration":600,"description":"Order"}`,
    'k',
  );
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(await entryCount(ctx), 1);
  // The path and query are part of the request.
  assert.equal((await send(ctx, `${path}?meta=true`, '{"description":"Order"}', 'k')).status, 422);
});

test('without a key every request creates; a malformed key is refused before anything is written', async () => {
  const ctx = await setup();
  const path = `${ws(ctx)}/time_entries`;
  const body = { description: 'Plain', start: '2026-10-14T09:00:00Z', duration: 600, workspace_id: ctx.wid };
  assert.equal((await send(ctx, path, body)).status, 200);
  assert.equal((await send(ctx, path, body)).status, 200);
  assert.equal(await entryCount(ctx), 2);
  for (const key of ['', 'has space', 'x'.repeat(256), 'caf\u00e9']) {
    const refused = await send(ctx, path, body, key);
    assert.equal(refused.status, 400, JSON.stringify(key));
    assert.equal(refused.body, 'Invalid Idempotency-Key: expected 1 to 255 visible ASCII characters');
  }
  assert.equal(await entryCount(ctx), 2);
  assert.equal((await send(ctx, path, body, 'k'.repeat(255))).status, 200);
});

test('a refused create records nothing, and a key past its retention creates again', async () => {
  const ctx = await setup();
  const path = `${ws(ctx)}/time_entries`;
  const refused = await send(ctx, path, { description: 7, start: '2026-10-14T09:00:00Z' }, 'retry');
  assert.equal(refused.status, 400);
  const body = { description: 'Kept', start: '2026-10-14T09:00:00Z', duration: 600, workspace_id: ctx.wid };
  const first = await send(ctx, path, body, 'retry');
  assert.equal(first.status, 200, 'the refused request left no record of the key');

  const old = new Date(Date.now() - IDEMPOTENCY_RETENTION_MS - 1000).toISOString();
  await corruptRecord(ctx.db, 'idempotency_keys', { created_at: old });
  const later = await send(ctx, path, body, 'retry');
  assert.equal(later.status, 200);
  assert.notEqual(later.body.id, first.body.id, 'an expired key creates again');
  assert.equal((await send(ctx, path, body, 'retry')).body.id, later.body.id);
  assert.equal(await entryCount(ctx), 2);
});

test('another user with the same key gets a create of their own', async () => {
  const ctx = await setup();
  const bob = await addUser(ctx, { email: 'bob@example.com', role: 'user' });
  const body = (wid: number) => ({
    description: 'Mine',
    start: '2026-10-14T09:00:00Z',
    duration: 600,
    workspace_id: wid,
  });
  const mine = await send(ctx, `${ws(ctx)}/time_entries`, body(ctx.wid), 'shared');
  const theirs = await send(bob, `${ws(bob)}/time_entries`, body(bob.wid), 'shared');
  assert.equal(theirs.status, 200);
  assert.notEqual(theirs.body.id, mine.body.id);
  assert.equal(await entryCount(bob), 1);
});

test('a repeat answers the record as it is now, and a 404 once it is gone', async () => {
  const ctx = await setup();
  const path = `${ws(ctx)}/clients`;
  const first = await send(ctx, path, { name: 'Acme' }, 'client');
  await ctx.json('PUT', `${path}/${first.body.id}`, { name: 'Acme Corp' });
  const renamed = await send(ctx, path, { name: 'Acme' }, 'client');
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.id, first.body.id);
  assert.equal(renamed.body.name, 'Acme Corp');
  assert.equal((await ctx.request('DELETE', `${path}/${first.body.id}`)).status, 200);
  assert.equal((await send(ctx, path, { name: 'Acme' }, 'client')).status, 404);
});

test('two requests with one key at once create once and answer the same record', async () => {
  const ctx = await setup();
  const path = `${ws(ctx)}/time_entries`;
  const body = { description: 'Race', start: '2026-10-14T09:00:00Z', duration: 600, workspace_id: ctx.wid };
  const replies = await Promise.all(Array.from({ length: 4 }, () => send(ctx, path, body, 'race')));
  assert.deepEqual(
    replies.map(reply => reply.status),
    [200, 200, 200, 200],
  );
  assert.equal(new Set(replies.map(reply => reply.body.id)).size, 1);
  assert.equal(await entryCount(ctx), 1);
});
