import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, RequestTimeoutError } from './client.ts';
import { clientRequests } from './clients.ts';
import { ignoreReply } from './decode.ts';
import { entryRequests } from './entries.ts';
import { newIdempotencyKey, postCreate, sendCreate } from './idempotency.ts';
import { projectRequests } from './projects.ts';
import { tagRequests } from './tags.ts';

/**
 * A fetch that answers each request with the next of `replies` (a status and JSON body, or an error
 * thrown as fetch throws) and records the path, body and `Idempotency-Key` of each.
 */
function answering(...replies: Array<{ status: number; body?: unknown } | { fail: Error }>) {
  const sent: Array<{ path: string; body: unknown; key: string | undefined }> = [];
  const fetch = (path: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    sent.push({ path, body: JSON.parse(String(init.body)), key: headers['Idempotency-Key'] });
    const reply = replies.shift();
    if (!reply) throw new Error(`No reply for ${path}`);
    if ('fail' in reply) return Promise.reject(reply.fail);
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch, sent };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

/** Awaits `pending`, firing every mocked timer it waits on. Mock the timers first. */
async function runningTimers<T>(t: TestContext, pending: Promise<T>): Promise<T> {
  let outcome: { value: T } | { error: unknown } | undefined;
  pending.then(
    value => (outcome = { value }),
    (error: unknown) => (outcome = { error }),
  );
  while (!outcome) {
    await flush();
    t.mock.timers.runAll();
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

test('a key is 32 hex characters, and each one is new', () => {
  const key = newIdempotencyKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.notEqual(newIdempotencyKey(), key);
});

test('a create whose outcome is unknown goes out once more with the same request and key', async t => {
  const { fetch, sent } = answering({ status: 502, body: 'Bad Gateway' }, { status: 200, body: { id: 7 } });
  t.mock.method(globalThis, 'fetch', fetch);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(
    await runningTimers(t, postCreate('/api/v9/workspaces/1/tags', { name: 'retry' }, { decode: value => value })),
    { id: 7 },
  );
  assert.equal(sent.length, 2);
  assert.ok(sent[0]?.key);
  assert.deepEqual(sent[1], sent[0]);
});

// The second attempt waits 1 s plus up to a quarter of it, as `Math.random` falls.
for (const [share, waitMs] of [
  [0, 1000],
  [0.5, 1125],
  [0.999_999, 1249],
] as const)
  test(`a create whose outcome is unknown goes out again only after the wait: ${waitMs} ms at ${share}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(Math, 'random', () => share);
    const keys: string[] = [];
    const replies = [() => Promise.reject(new RequestTimeoutError('POST', '/w')), () => Promise.resolve('made')];
    const sent = sendCreate('POST /w {}', key => {
      keys.push(key);
      return replies.shift()!();
    });
    await flush();
    t.mock.timers.tick(waitMs - 1);
    await flush();
    assert.equal(keys.length, 1, 'nothing goes out during the wait');
    t.mock.timers.tick(1);
    assert.equal(await sent, 'made');
    assert.deepEqual(keys, [keys[0], keys[0]]);
  });

test('the same request sent again during the wait reuses the key', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const keys: string[] = [];
  const replies = [
    () => Promise.reject(new RequestTimeoutError('POST', '/d')),
    () => Promise.resolve('replayed by the user'),
    () => Promise.resolve('replayed by the retry'),
  ];
  const send = (key: string) => {
    keys.push(key);
    return replies.shift()!();
  };
  const first = sendCreate('POST /d {}', send);
  await flush();
  assert.equal(await sendCreate('POST /d {}', send), 'replayed by the user');
  assert.equal(await runningTimers(t, first), 'replayed by the retry');
  assert.deepEqual(keys, [keys[0], keys[0], keys[0]]);
  // Both settled the intent: the same request again is a new one.
  replies.push(() => Promise.resolve('new'));
  await sendCreate('POST /d {}', send);
  assert.notEqual(keys[3], keys[0]);
});

test('a refused create is not sent again', async t => {
  const { fetch, sent } = answering({ status: 400, body: 'Name taken' });
  t.mock.method(globalThis, 'fetch', fetch);
  await assert.rejects(
    postCreate('/api/v9/workspaces/1/tags', { name: 'refused' }, { decode: ignoreReply }),
    (error: unknown) => {
      return error instanceof ApiError && error.status === 400;
    },
  );
  assert.equal(sent.length, 1);
});

test('a new intent gets a new key, even for the same request', async t => {
  const { fetch, sent } = answering({ status: 200, body: { id: 1 } }, { status: 200, body: { id: 2 } });
  t.mock.method(globalThis, 'fetch', fetch);
  await postCreate('/api/v9/workspaces/1/tags', { name: 'twice' }, { decode: ignoreReply });
  await postCreate('/api/v9/workspaces/1/tags', { name: 'twice' }, { decode: ignoreReply });
  assert.deepEqual(sent[1]?.body, sent[0]?.body);
  assert.notEqual(sent[1]?.key, sent[0]?.key);
});

test('a create still unknown after its retry keeps its key for the same request sent again, and only for it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const keys: string[] = [];
  const answer = (reply: () => Promise<string>) => (key: string) => {
    keys.push(key);
    return reply();
  };
  const lost = answer(() => Promise.reject(new RequestTimeoutError('POST', '/x')));
  await assert.rejects(
    runningTimers(t, sendCreate('POST /x {"a":1}', lost)),
    (error: unknown) => error instanceof RequestTimeoutError,
  );
  assert.equal(keys.length, 2);
  assert.equal(keys[1], keys[0]);
  // The user sends the same request again: the server answers the record the lost one made.
  assert.equal(
    await sendCreate(
      'POST /x {"a":1}',
      answer(() => Promise.resolve('replayed')),
    ),
    'replayed',
  );
  assert.equal(keys[2], keys[0]);
  // That reply settled the intent: the same request again is a new one.
  await sendCreate(
    'POST /x {"a":1}',
    answer(() => Promise.resolve('new')),
  );
  assert.notEqual(keys[3], keys[0]);
  // Another request never reuses a kept key.
  await assert.rejects(runningTimers(t, sendCreate('POST /x {"a":2}', lost)));
  await sendCreate(
    'POST /x {"a":3}',
    answer(() => Promise.resolve('other')),
  );
  assert.notEqual(keys[6], keys[4]);
});

test('a new intent forgets the kept keys past their 23 hours, and only those', async t => {
  const hour = 60 * 60 * 1000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-01T00:00:00Z') });
  // Each retry waits exactly 1 s, which the mocked clock moves on by.
  t.mock.method(Math, 'random', () => 0);
  const keys: Record<string, string[]> = {};
  const answer = (request: string, reply: () => Promise<string>) =>
    sendCreate(request, key => {
      (keys[request] ??= []).push(key);
      return reply();
    });
  const lost = () => Promise.reject(new RequestTimeoutError('POST', '/x'));
  await assert.rejects(runningTimers(t, answer('POST /old {}', lost)));
  t.mock.timers.tick(12 * hour);
  await assert.rejects(runningTimers(t, answer('POST /recent {}', lost)));
  const deleted = t.mock.method(Map.prototype, 'delete');
  const forgotten = () =>
    deleted.mock.calls.map(call => call.arguments[0]).filter(key => typeof key === 'string' && key.startsWith('POST '));
  // The old key is 1 ms short of its 23 hours: a new intent keeps it.
  t.mock.timers.tick(11 * hour - 2001);
  await answer('POST /first {}', () => Promise.resolve('made'));
  assert.deepEqual(forgotten(), []);
  t.mock.timers.tick(1);
  await answer('POST /second {}', () => Promise.resolve('made'));
  assert.deepEqual(forgotten(), ['POST /old {}']);
  // The recent key was kept: the same request again still uses it.
  await answer('POST /recent {}', () => Promise.resolve('replayed'));
  assert.equal(keys['POST /recent {}']![2], keys['POST /recent {}']![0]);
});

/** What each create answers, in the order the test below sends them: the record it made, or for a task nothing read. */
const created = [
  {
    id: 1,
    workspace_id: 1,
    project_id: null,
    task_id: null,
    billable: false,
    start: '2026-10-27T10:00:00+00:00',
    stop: '2026-10-27T11:00:00+00:00',
    duration: 3600,
    description: 'Entry',
    tags: [],
    tag_ids: [],
    at: '2026-10-27T11:00:00+00:00',
    server_deleted_at: null,
    all_day: false,
  },
  { id: 1, wid: 1, name: 'Client', notes: null, archived: false },
  {
    id: 2,
    workspace_id: 1,
    client_id: null,
    client_name: null,
    name: 'Project',
    color: '#06aaf5',
    active: true,
    billable: false,
    estimated_hours: null,
    rate: null,
    currency: null,
    actual_seconds: 0,
    status: 'active',
  },
  { id: 1 },
  { id: 1, workspace_id: 1, name: 'Tag' },
];

test('every create the server keys sends an Idempotency-Key', async t => {
  const { fetch, sent } = answering(...created.map(body => ({ status: 200, body })));
  t.mock.method(globalThis, 'fetch', fetch);
  await entryRequests.create(1, { description: 'Entry' });
  await clientRequests.create(1, { name: 'Client' });
  await projectRequests.create(1, { name: 'Project' });
  await projectRequests.createTask(1, 2, 'Task');
  await tagRequests.create(1, 'Tag');
  assert.deepEqual(
    sent.map(request => request.path),
    [
      '/api/v9/workspaces/1/time_entries?meta=true',
      '/api/v9/workspaces/1/clients',
      '/api/v9/workspaces/1/projects',
      '/api/v9/workspaces/1/projects/2/tasks',
      '/api/v9/workspaces/1/tags',
    ],
  );
  for (const request of sent) assert.match(request.key ?? '', /^[0-9a-f]{32}$/, request.path);
});
