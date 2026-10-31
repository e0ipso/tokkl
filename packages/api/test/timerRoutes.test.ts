import { corruptRecord } from './fixtures/physical.ts';
import { test, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { TimerState } from '@tokkl/types';
import { storageFor, setServices } from './fixtures/database.ts';
import { createApp } from '../src/app.ts';
import { TimerStreams, type TimerStreamOptions } from '../src/services/timerStreams.ts';
import { CSRF, PASSWORD, replaceFixtureApp, addUser, sessionCookie, setup, testConfig, testServer, type TestContext, type TestServer } from './helpers.ts';

/** Longer than any test runs, so a stream that closes did so because of a recheck, not a keep-alive tick. */
const SLOW_KEEP_ALIVE_MS = 600_000;
/** A stream that should close but does not fails the test instead of holding the run open. */
const STREAM_TEST = { timeout: 30_000 };

type Message = { event: string; data: string } | { comment: string };

interface EventStream {
  response: Response;
  /** The next message, or null once the server has ended the stream. */
  next: () => Promise<Message | null>;
  /** The next `timer` event's state, skipping comments and keep-alives. Fails if the stream ends first. */
  nextState: () => Promise<TimerState>;
  /** The next `keep-alive` event, skipping everything else. Fails if the stream ends first. */
  nextKeepAlive: () => Promise<Message>;
  /** Resolves once the server has ended the stream, skipping whatever arrives before. */
  ended: () => Promise<void>;
}

/** An app over `ctx.db` whose timer streams use `options`, and a request signed in by `ctx.user`'s API token. */
function streamingApp(ctx: TestContext, options: TimerStreamOptions) {
  return replaceFixtureApp(ctx,options);
}

function basic(user: { apiToken: string }): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}` };
}

/** Sends JSON to `server` and reads the JSON reply. */
async function call(server: TestServer, method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const response = await server.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

/**
 * Opens GET /api/app/timer/events on `server` and reads it as Server-Sent Events. The stream is
 * aborted when the test ends, so no connection outlives it.
 */
async function openStream(t: NodeTestContext, server: TestServer, headers: Record<string, string>): Promise<EventStream> {
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await server.request('/api/app/timer/events', { headers, signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (): Promise<Message | null> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith(':')) return { comment: block.slice(1).trim() };
        const fields = Object.fromEntries(block.split('\n').map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon), line.slice(colon + 1).trimStart()];
        }));
        return { event: fields.event ?? 'message', data: fields.data ?? '' };
      }
      const { done, value } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const nextOf = async <T>(pick: (message: Message) => T | undefined): Promise<T> => {
    for (;;) {
      const message = (await next());
      assert.ok(message, 'the stream ended');
      const picked = pick(message);
      if (picked !== undefined) return picked;
    }
  };
  return {
    response,
    next,
    nextState: async () => (await nextOf((message) => {
      if (!('event' in message) || message.event === 'keep-alive') return undefined;
      assert.equal(message.event, 'timer');
      assert.ok(!message.data.includes('\n'));
      return JSON.parse(message.data) as TimerState;
    })),
    nextKeepAlive: async () => (await nextOf((message) => ('event' in message && message.event === 'keep-alive' ? message : undefined))),
    ended: async () => {
      while ((await next()) !== null);
    },
  };
}

test('timer routes take a token or a cookie, and cookie writes need the CSRF header', async () => {
  const ctx = (await setup());
  const { server } = streamingApp(ctx, {});
  const cookie = (await sessionCookie(ctx));

  const byToken = (await call(server, 'GET', '/api/app/timer', basic(ctx.user)));
  assert.equal(byToken.status, 200);
  assert.equal(byToken.body.revision, 0);
  assert.equal(byToken.body.running_entry, null);
  const byCookie = (await call(server, 'GET', '/api/app/timer', { cookie }));
  assert.equal(byCookie.status, 200);
  assert.equal(byCookie.body.revision, 0);
  assert.equal((await call(server, 'GET', '/api/app/timer', {})).status, 403);

  const withoutCsrf = (await call(server, 'POST', '/api/app/pomodoro', { cookie }, {}));
  assert.equal(withoutCsrf.status, 403);
  assert.equal(withoutCsrf.body, 'Missing CSRF header');
  const withCsrf = (await call(server, 'POST', '/api/app/pomodoro', { cookie, ...CSRF }, {}));
  assert.equal(withCsrf.status, 200);
  assert.ok(withCsrf.body.pomodoro);
});

test('a session and a pause chain run over HTTP, and a stale revision gets 409 with the state', async () => {
  const ctx = (await setup());
  const { server } = streamingApp(ctx, {});
  const auth = basic(ctx.user);

  const started = (await call(server, 'POST', '/api/app/pomodoro', auth, { description: 'Deep work' }));
  assert.equal(started.status, 200);
  assert.equal(started.body.pomodoro.phase.kind, 'work');
  assert.equal(started.body.running_entry.description, 'Deep work');
  const again = (await call(server, 'POST', '/api/app/pomodoro', auth, {}));
  assert.equal(again.status, 409);
  assert.equal(again.body.revision, started.body.revision, 'the 409 body is the current state');

  const rest = (await call(server, 'POST', '/api/app/pomodoro/next', auth, { revision: started.body.revision }));
  assert.equal(rest.status, 200);
  assert.ok(rest.body.revision > started.body.revision);
  assert.equal(rest.body.pomodoro.phase.kind, 'shortRest');

  const stale = (await call(server, 'POST', '/api/app/pomodoro/next', auth, { revision: started.body.revision }));
  assert.equal(stale.status, 409);
  assert.deepEqual({ ...stale.body, server_time: null }, { ...rest.body, server_time: null });

  assert.equal((await call(server, 'POST', '/api/app/pomodoro/next', auth, {})).status, 400);
  assert.equal((await call(server, 'POST', '/api/app/pomodoro/end', auth, 'not an object')).status, 400);

  const ended = (await call(server, 'POST', '/api/app/pomodoro/end', auth, { revision: rest.body.revision }));
  assert.equal(ended.status, 200);
  assert.ok(ended.body.revision > rest.body.revision);
  assert.equal(ended.body.pomodoro, null);

  const entry = (await call(server, 'POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, auth,
    { start: new Date().toISOString(), duration: -1, description: 'Writing', created_with: 'test' }));
  assert.equal(entry.status, 200);
  const paused = (await call(server, 'POST', '/api/app/timer/pause', auth, {}));
  assert.equal(paused.status, 200);
  assert.equal(paused.body.pause.paused, true);
  assert.equal(paused.body.running_entry, null);
  const resumed = (await call(server, 'POST', '/api/app/timer/resume', auth, { revision: paused.body.revision }));
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.running_entry.description, 'Writing');
  const pausedAgain = (await call(server, 'POST', '/api/app/timer/pause', auth, {}));
  assert.equal(pausedAgain.status, 200);
  const discarded = (await call(server, 'POST', '/api/app/timer/discard', auth, { revision: pausedAgain.body.revision }));
  assert.equal(discarded.status, 200);
  assert.equal(discarded.body.pause, null);
  assert.ok(discarded.body.revision > pausedAgain.body.revision);
  const nothingRuns = (await call(server, 'POST', '/api/app/timer/pause', auth, {}));
  assert.equal(nothingRuns.status, 409);
  assert.equal(nothingRuns.body.revision, discarded.body.revision);
});

test('the stream sends the state on connect and on every change', STREAM_TEST, async (t) => {
  const ctx = (await setup());
  const { server } = streamingApp(ctx, { keepAliveMs: SLOW_KEEP_ALIVE_MS });
  const stream = (await openStream(t, server, basic(ctx.user)));

  assert.match(stream.response.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(stream.response.headers.get('cache-control'), 'no-store');
  assert.equal(stream.response.headers.get('x-accel-buffering'), 'no');
  const idle = await stream.nextState();
  assert.equal(idle.revision, 0);
  assert.equal(idle.running_entry, null);
  assert.equal(idle.pomodoro, null);

  const started = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`,
    { start: new Date().toISOString(), duration: -1, description: 'From another client', created_with: 'test' });
  assert.equal(started.status, 200);
  const running = await stream.nextState();
  assert.ok(running.revision > idle.revision);
  assert.equal(running.running_entry?.id, started.body.id);
});

test('keep-alive events go out, and each tick checks the credential again', STREAM_TEST, async (t) => {
  const ctx = (await setup());
  const { server } = streamingApp(ctx, { keepAliveMs: 50 });
  const cookie = (await sessionCookie(ctx));
  const stream = (await openStream(t, server, { cookie }));
  await stream.nextState();
  // A named event with data, because a browser EventSource never surfaces comments.
  assert.deepEqual(await stream.nextKeepAlive(), { event: 'keep-alive', data: '' });

  // Expiry ends a session without any request, so only the tick can notice.
  await corruptRecord(ctx.db,'sessions',{expires_at:'2000-01-01T00:00:00.000Z'},{user_id:ctx.user.id});
  await stream.ended();
});

test('a stream closes at once when its credential ends', STREAM_TEST, async (t) => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const { server } = streamingApp(admin, { keepAliveMs: SLOW_KEEP_ALIVE_MS });

  const cookie = (await sessionCookie(admin));
  const cookieStream = (await openStream(t, server, { cookie }));
  const tokenStream = (await openStream(t, server, basic(admin.user)));
  await cookieStream.nextState();
  await tokenStream.nextState();
  assert.equal((await call(server, 'POST', '/api/app/logout', { cookie, ...CSRF })).status, 200);
  await cookieStream.ended();

  const rotated = (await call(server, 'POST', '/api/v9/me/reset_token', basic(admin.user)));
  assert.equal(rotated.status, 200);
  await tokenStream.ended();

  // A password-Basic stream ends when the password changes.
  const password = { authorization: `Basic ${Buffer.from(`bob@example.com:${PASSWORD}`).toString('base64')}` };
  const passwordStream = (await openStream(t, server, password));
  await passwordStream.nextState();
  const changed = (await call(server, 'PUT', '/api/v9/me', password, { current_password: PASSWORD, password: 'another password 1' }));
  assert.equal(changed.status, 200);
  await passwordStream.ended();

  const bobStream = (await openStream(t, server, basic({ apiToken: changed.body.api_token })));
  await bobStream.nextState();
  const suspended = (await call(server, 'PATCH', `/api/app/admin/users/${bob.user.id}`, basic({ apiToken: rotated.body }), { disabled: true }));
  assert.equal(suspended.status, 200);
  await bobStream.ended();
});

test('opening one stream over the cap closes the oldest', STREAM_TEST, async (t) => {
  const ctx = (await setup());
  const { server } = streamingApp(ctx, { keepAliveMs: SLOW_KEEP_ALIVE_MS, maxPerUser: 2 });
  const [oldest, middle] = [(await openStream(t, server, basic(ctx.user))), (await openStream(t, server, basic(ctx.user)))];
  await oldest.nextState();
  await middle.nextState();
  const newest = (await openStream(t, server, basic(ctx.user)));
  await newest.nextState();
  await oldest.ended();

  const started = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`,
    { start: new Date().toISOString(), duration: -1, created_with: 'test' });
  assert.equal((await middle.nextState()).running_entry?.id, started.body.id);
  assert.equal((await newest.nextState()).running_entry?.id, started.body.id);
});

test('closing every stream lets the server close', STREAM_TEST, async (t) => {
  const ctx = (await setup());
  const app=createApp({storage:storageFor(ctx.db),config:testConfig(),setup:{code:null},timerStreamOptions:{keepAliveMs:SLOW_KEEP_ALIVE_MS}});
  const streams=app.locals.services.timerStreams;
  const listening = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  const port = (listening.address() as AddressInfo).port;
  const server: TestServer = { request: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init) };
  const stream = (await openStream(t, server, basic(ctx.user)));
  await stream.nextState();

  await streams.closeAll();
  await new Promise<void>((resolve, reject) => listening.close((error) => (error ? reject(error) : resolve())));
  await stream.ended();
});
