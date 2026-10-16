import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { generateApiToken, MAX_PASSWORD_LENGTH } from '../src/auth/crypto.ts';
import { FailureLimiter } from '../src/auth/rateLimit.ts';
import { openDatabase, type Db } from '../src/db/index.ts';
import { createOwner, getUser, type UserRow } from '../src/models/users.ts';
import { PASSWORD, setup, testConfig, testServer } from './helpers.ts';

test('API token Basic auth works and wrong credentials get 403', async () => {
  const ctx = await setup();
  const me = await ctx.json('GET', '/api/v9/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'me@example.com');
  assert.equal(me.body.api_token, ctx.user.api_token);
  assert.equal(me.body.default_workspace_id, ctx.wid);

  const bad = await ctx.request('GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from('deadbeef:api_token').toString('base64')}`,
  });
  assert.equal(bad.status, 403);

  const none = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '' });
  assert.equal(none.status, 403);
});

test('email and password Basic auth works', async () => {
  const ctx = await setup();
  const ok = await ctx.request('GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from(`me@example.com:${PASSWORD}`).toString('base64')}`,
  });
  assert.equal(ok.status, 200);
  const wrong = await ctx.request('GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from('me@example.com:nope').toString('base64')}`,
  });
  assert.equal(wrong.status, 403);
});

test('session cookie login requires the CSRF header for writes', async () => {
  const ctx = await setup();
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!;
  assert.match(cookie, /tokkl_session=/);
  assert.match(cookie, /HttpOnly/);
  const session = cookie.split(';')[0]!;

  const read = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: session });
  assert.equal(read.status, 200);

  const body = { start: new Date().toISOString(), duration: -1, created_with: 'test' };
  const noCsrf = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, body, { authorization: '', cookie: session });
  assert.equal(noCsrf.status, 403);
  const withCsrf = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, body, {
    authorization: '', cookie: session, 'x-tokkl-csrf': '1',
  });
  assert.equal(withCsrf.status, 200);

  const logoutNoCsrf = await ctx.request('POST', '/api/app/logout', undefined, { authorization: '', cookie: session });
  assert.equal(logoutNoCsrf.status, 403);
  const stillIn = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: session });
  assert.equal(stillIn.status, 200);
  const logout = await ctx.request('POST', '/api/app/logout', undefined, { authorization: '', cookie: session, 'x-tokkl-csrf': '1' });
  assert.equal(logout.status, 200);
  const after = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: session });
  assert.equal(after.status, 403);
});

test('wrong passwords are rate limited', async () => {
  const ctx = await setup();
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const response = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: 'wrong' }, { authorization: '' });
    last = response.status;
  }
  assert.equal(last, 429);
});

test('first-run setup needs the setup code and only works once', async () => {
  const db = openDatabase(':memory:');
  const setupState = { code: 'ABCD-EFGH-JKLM' };
  const app = testServer(createApp({ db, config: testConfig(), setup: setupState }));
  const post = (body: unknown) => (app.request('/api/app/setup', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: true });
  const account = { email: 'owner@example.com', password: 'long enough', fullname: 'Owner', timezone: 'Europe/Madrid' };
  assert.equal((await post({ ...account, setup_code: 'WRONG' })).status, 403);
  const ok = await post({ ...account, setup_code: 'ABCD-EFGH-JKLM' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') ?? '', /tokkl_session=/);
  assert.equal((await post({ ...account, setup_code: 'ABCD-EFGH-JKLM' })).status, 403);
  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: false });
});

test('reset_token issues a new token and invalidates the old one', async () => {
  const ctx = await setup();
  const reset = await ctx.json('POST', '/api/v9/me/reset_token');
  assert.equal(reset.status, 200);
  assert.match(reset.body, /^[0-9a-f]{32}$/);
  assert.equal((await ctx.request('GET', '/api/v9/me')).status, 403);
});

test('PUT /me changes the password only with the current one', async () => {
  const ctx = await setup();
  const wrong = await ctx.json('PUT', '/api/v9/me', { current_password: 'nope', password: 'new password 1' });
  assert.equal(wrong.status, 400);
  const ok = await ctx.json('PUT', '/api/v9/me', { current_password: PASSWORD, password: 'new password 1', timezone: 'Europe/Madrid' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.timezone, 'Europe/Madrid');
  const login = await ctx.request('GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from('me@example.com:new password 1').toString('base64')}`,
  });
  assert.equal(login.status, 200);
});

/** createOwner refuses a second account, so tests that need one insert it directly. */
function insertSecondUser(db: Db, owner: UserRow, email: string): UserRow {
  const result = db.prepare(`
    INSERT INTO users (email, fullname, password_hash, api_token, timezone, default_workspace_id, preferences, created_at, updated_at)
    VALUES (?, '', ?, ?, 'UTC', ?, '{}', ?, ?)
  `).run(email, owner.password_hash, generateApiToken(), owner.default_workspace_id, owner.created_at, owner.created_at);
  return getUser(db, Number(result.lastInsertRowid))!;
}

test('PUT /me refuses an email another user has, in any case, and allows recasing your own', async () => {
  const ctx = await setup();
  const other = insertSecondUser(ctx.db, ctx.user, 'b@example.com');
  const putAs = async (user: UserRow, body: unknown) => {
    const response = await ctx.request('PUT', '/api/v9/me', body, { authorization: basic(user.api_token, 'api_token') });
    return { status: response.status, body: await response.json() as any };
  };

  for (const email of ['me@example.com', 'ME@EXAMPLE.COM', '  Me@Example.com  ']) {
    const taken = await putAs(other, { email, fullname: 'Renamed' });
    assert.equal(taken.status, 400, email);
    assert.equal(taken.body, 'Email already in use');
    assert.equal(getUser(ctx.db, other.id)!.email, 'b@example.com', 'the email is unchanged');
    assert.equal(getUser(ctx.db, other.id)!.fullname, '', 'nothing else is written either');
  }

  const recased = await putAs(ctx.user, { email: 'Me@Example.COM' });
  assert.equal(recased.status, 200);
  assert.equal(recased.body.email, 'Me@Example.COM');
  assert.equal(getUser(ctx.db, ctx.user.id)!.email, 'Me@Example.COM');
  assert.equal((await putAs(other, { email: 'b@example.com' })).status, 200, 'resending your own email is fine');
});

test('behind a trusted proxy the rate limit keys on the last X-Forwarded-For hop', async () => {
  const { createApp: create } = await import('../src/app.ts');
  const { openDatabase: open } = await import('../src/db/index.ts');
  const { createOwner } = await import('../src/models/users.ts');
  const db = open(':memory:');
  await createOwner(db, { email: 'me@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' });
  const app = testServer(create({ db, config: { ...testConfig(), trustProxy: true }, setup: { code: null } }));
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const response = await app.request('/api/app/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}, 192.168.1.50` },
      body: JSON.stringify({ email: 'me@example.com', password: 'wrong' }),
    });
    last = response.status;
  }
  assert.equal(last, 429, 'a spoofed leftmost entry must not reset the limit');
});

test('bad since and bad report dates are 400, not 500', async () => {
  const ctx = await setup();
  assert.equal((await ctx.json('GET', '/api/v9/me/time_entries?since=99999999999999999')).status, 400);
  const weekly = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/weekly/time_entries`, { start_date: 'garbage' });
  assert.equal(weekly.status, 400);
  const many = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`, {
    start_date: '2026-10-01', end_date: '2026-10-02', project_ids: Array.from({ length: 1001 }, (_, i) => i + 1),
  });
  assert.equal(many.status, 400);
});

const basic = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

test('setup rejects new passwords longer than MAX_PASSWORD_LENGTH', async () => {
  const db = openDatabase(':memory:');
  const app = testServer(createApp({ db, config: testConfig(), setup: { code: 'ABCD-EFGH-JKLM' } }));
  const post = (password: string) => app.request('/api/app/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password, fullname: 'Owner', setup_code: 'ABCD-EFGH-JKLM' }),
  });

  const tooLong = await post('x'.repeat(MAX_PASSWORD_LENGTH + 1));
  assert.equal(tooLong.status, 400);
  assert.equal(await tooLong.json(), `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: true });

  const longest = 'y'.repeat(MAX_PASSWORD_LENGTH);
  assert.equal((await post(longest)).status, 200);
  const login = await app.request('/api/app/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: longest }),
  });
  assert.equal(login.status, 200);
});

test('an owner with a password over the cap can still log in and rotate it', async () => {
  const db = openDatabase(':memory:');
  const legacy = 'L'.repeat(MAX_PASSWORD_LENGTH * 2);
  const user = await createOwner(db, { email: 'me@example.com', password: legacy, fullname: '', timezone: 'UTC' });
  const app = testServer(createApp({ db, config: testConfig(), setup: { code: null } }));
  const put = (body: unknown) => app.request('/api/v9/me', {
    method: 'PUT',
    headers: { authorization: basic(user.api_token, 'api_token'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const login = await app.request('/api/app/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'me@example.com', password: legacy }),
  });
  assert.equal(login.status, 200);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', legacy) } })).status, 200);

  const newTooLong = await put({ current_password: legacy, password: 'n'.repeat(MAX_PASSWORD_LENGTH + 1) });
  assert.equal(newTooLong.status, 400);
  assert.equal(await newTooLong.json(), `password must be at most ${MAX_PASSWORD_LENGTH} characters`);

  assert.equal((await put({ current_password: legacy, password: 'new password 1' })).status, 200);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', legacy) } })).status, 403);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', 'new password 1') } })).status, 200);
});

test('twelve parallel wrong passwords across login, Basic auth and password change run at most ten checks', async () => {
  const ctx = await setup();
  const kinds = ['login', 'basic', 'change'] as const;
  const wrong = (kind: (typeof kinds)[number]) => {
    if (kind === 'login') {
      return ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: 'wrong' }, { authorization: '' });
    }
    if (kind === 'basic') return ctx.request('GET', '/api/v9/me', undefined, { authorization: basic('me@example.com', 'wrong') });
    // Token-authenticated, so only the current_password check counts.
    return ctx.request('PUT', '/api/v9/me', { current_password: 'wrong', password: 'new password 1' });
  };
  const requests = Array.from({ length: 12 }, (_, i) => kinds[i % kinds.length]!);
  const statuses = (await Promise.all(requests.map(async (kind) => ({ kind, status: (await wrong(kind)).status }))));

  const limited = statuses.filter(({ status }) => status === 429);
  assert.equal(limited.length, 2, JSON.stringify(statuses));
  const expected = { login: 403, basic: 403, change: 400 };
  for (const { kind, status } of statuses.filter(({ status }) => status !== 429)) assert.equal(status, expected[kind], kind);

  // Blocked for passwords, even the right one, but API tokens are exempt.
  const right = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '' });
  assert.equal(right.status, 429);
  assert.equal((await ctx.request('GET', '/api/v9/me')).status, 200);
});

test('a successful login resets the failure count', async () => {
  const ctx = await setup();
  const login = (password: string) => ctx.request('POST', '/api/app/login', { email: 'me@example.com', password }, { authorization: '' });
  for (let i = 0; i < 9; i++) assert.equal((await login('wrong')).status, 403);
  assert.equal((await login(PASSWORD)).status, 200);

  const afterReset = await Promise.all(Array.from({ length: 10 }, () => login('wrong')));
  assert.deepEqual(afterReset.map((response) => response.status), Array(10).fill(403));
  assert.equal((await login('wrong')).status, 429);
});

test('wrong API tokens are not counted as password failures', async () => {
  const ctx = await setup();
  for (let i = 0; i < 12; i++) {
    const response = await ctx.request('GET', '/api/v9/me', undefined, { authorization: basic('deadbeef', 'api_token') });
    assert.equal(response.status, 403);
  }
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '' });
  assert.equal(login.status, 200);
});

test('FailureLimiter runs no checks past the limit and unblocks when the window expires', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const windowMs = 15 * 60 * 1000;
  const limiter = new FailureLimiter(10, windowMs);
  let checks = 0;
  const failingCheck = async () => {
    checks++;
    await new Promise((resolve) => setImmediate(resolve));
    return false;
  };

  const results = await Promise.all(Array.from({ length: 12 }, () => limiter.attempt('1.2.3.4', failingCheck)));
  assert.equal(checks, 10);
  assert.equal(results.filter((result) => result === false).length, 10);
  assert.equal(results.filter((result) => result === null).length, 2);
  assert.equal(await limiter.attempt('5.6.7.8', async () => true), true, 'other addresses are unaffected');

  t.mock.timers.tick(windowMs - 1);
  assert.equal(await limiter.attempt('1.2.3.4', async () => true), null);
  assert.equal(checks, 10);
  t.mock.timers.tick(1);
  assert.equal(await limiter.attempt('1.2.3.4', async () => true), true);
});

test('logout with a wrong CSRF value keeps the session; no or stale session logout is 200', async () => {
  const ctx = await setup();
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '' });
  const session = login.headers.get('set-cookie')!.split(';')[0]!;
  const logout = (headers: Record<string, string>) => ctx.request('POST', '/api/app/logout', undefined, { authorization: '', ...headers });
  const me = () => ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: session });

  for (const value of ['0', 'true', '']) {
    const refused = await logout({ cookie: session, 'x-tokkl-csrf': value });
    assert.equal(refused.status, 403, `CSRF value ${JSON.stringify(value)}`);
    assert.equal(refused.headers.get('set-cookie'), null);
    assert.equal((await me()).status, 200);
  }

  const ok = await logout({ cookie: session, 'x-tokkl-csrf': '1' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') ?? '', /tokkl_session=;/);
  assert.equal((await me()).status, 403);

  assert.equal((await logout({ cookie: session })).status, 200, 'stale session');
  assert.equal((await logout({ cookie: 'tokkl_session=not-a-session' })).status, 200, 'unknown session');
  assert.equal((await logout({})).status, 200, 'no cookie');
});

test('the tt_session cookie and X-Timetrack-CSRF header from before the rename still work', async () => {
  const ctx = await setup();
  const signIn = () => ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '' });
  const login = await signIn();
  const issued = login.headers.getSetCookie();
  assert.ok(issued.some((cookie) => /^tokkl_session=[^;]+;/.test(cookie)), 'login issues the new cookie');
  assert.ok(issued.some((cookie) => /^tt_session=;/.test(cookie)), 'login clears the old cookie');
  const token = issued.find((cookie) => cookie.startsWith('tokkl_session='))!.split(';')[0]!.split('=')[1]!;
  const legacy = `tt_session=${token}`;
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    ctx.request(method, path, body, { authorization: '', ...headers });
  const entry = { start: new Date().toISOString(), duration: 60, created_with: 'test' };
  const entries = `/api/v9/workspaces/${ctx.wid}/time_entries`;

  assert.equal((await call('GET', '/api/v9/me', { cookie: legacy })).status, 200, 'old cookie reads');
  assert.equal((await call('POST', entries, { cookie: legacy }, entry)).status, 403, 'old cookie still needs a CSRF header');
  assert.equal((await call('POST', entries, { cookie: legacy, 'x-timetrack-csrf': '1' }, entry)).status, 200, 'old cookie and old header');
  assert.equal((await call('POST', entries, { cookie: `tokkl_session=${token}`, 'x-timetrack-csrf': '1' }, entry)).status, 200, 'old header');
  assert.equal((await call('POST', entries, { cookie: legacy, 'x-tokkl-csrf': '1' }, entry)).status, 200, 'old cookie and new header');

  // A stale old cookie next to a live new one does not block the request.
  const both = `tt_session=not-a-session; tokkl_session=${token}`;
  assert.equal((await call('GET', '/api/v9/me', { cookie: both })).status, 200);

  // Changing the password through the old cookie keeps that session and ends the others.
  const other = (await signIn()).headers.getSetCookie().find((cookie) => cookie.startsWith('tokkl_session='))!.split(';')[0]!;
  const change = await call('PUT', '/api/v9/me', { cookie: legacy, 'x-timetrack-csrf': '1' }, { current_password: PASSWORD, password: 'new password 1' });
  assert.equal(change.status, 200);
  assert.equal((await call('GET', '/api/v9/me', { cookie: legacy })).status, 200, 'the changing session stays');
  assert.equal((await call('GET', '/api/v9/me', { cookie: other })).status, 403, 'other sessions end');

  assert.equal((await call('POST', '/api/app/logout', { cookie: legacy })).status, 403, 'logout of an old-cookie session needs the header');
  const logout = await call('POST', '/api/app/logout', { cookie: legacy, 'x-timetrack-csrf': '1' });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.getSetCookie();
  assert.ok(cleared.some((cookie) => cookie.startsWith('tokkl_session=;')));
  assert.ok(cleared.some((cookie) => cookie.startsWith('tt_session=;')));
  assert.equal((await call('GET', '/api/v9/me', { cookie: legacy })).status, 403, 'logout ended the session');
});
