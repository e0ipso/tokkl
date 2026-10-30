import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storageFor, filenameFor, setServices } from './fixtures/database.ts';
import { createApp } from '../src/app.ts';
import { hashPassword, generateApiToken, MAX_PASSWORD_LENGTH } from '../src/auth/crypto.ts';
import {
  ACCOUNT_ADDRESS_LIMIT, accountCounters, FailureLimiter, normalizeEmail, passwordCounters, SETUP_CODE_LIMIT,
} from '../src/auth/rateLimit.ts';
import { openDatabase, type FixtureDatabase } from './fixtures/database.ts';
import { MIGRATIONS } from './fixtures/legacyMigrations.ts';
import { insertAccount, createFirstAdmin, getUser, type User } from './fixtures/domain.ts';
import { CSRF, PASSWORD, setup, testConfig, testServer } from './helpers.ts';

test('API token Basic auth works and wrong credentials get 403', async () => {
  const ctx = (await setup());
  const me = await ctx.json('GET', '/api/v9/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'me@example.com');
  assert.equal(me.body.api_token, ctx.user.apiToken);
  assert.equal(me.body.default_workspace_id, ctx.wid);

  const bad = await ctx.request('GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from('deadbeef:api_token').toString('base64')}`,
  });
  assert.equal(bad.status, 403);

  const none = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '' });
  assert.equal(none.status, 403);
});

test('email and password Basic auth works', async () => {
  const ctx = (await setup());
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
  const ctx = (await setup());
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '', ...CSRF });
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
  const ctx = (await setup());
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const response = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: 'wrong' }, { authorization: '', ...CSRF });
    last = response.status;
  }
  assert.equal(last, 429);
});

test('first-run setup needs the setup code and only works once', async () => {
  const db = (await openDatabase(':memory:'));
  const setupState = { code: 'ABCD-EFGH-JKLM' };
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: setupState }));
  const post = (body: unknown) => (app.request('/api/app/setup', {
    method: 'POST', headers: { ...CSRF, 'content-type': 'application/json' }, body: JSON.stringify(body),
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

test('setup stores the canonical timezone, refuses invalid and offset ones, and defaults to UTC', async () => {
  const attempt = async (timezone: unknown) => {
    const db = (await openDatabase(':memory:'));
    const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: { code: 'ABCD-EFGH-JKLM' } }));
    const account = { email: 'owner@example.com', password: 'long enough', fullname: 'Owner', setup_code: 'ABCD-EFGH-JKLM' };
    const response = await app.request('/api/app/setup', {
      method: 'POST', headers: { ...CSRF, 'content-type': 'application/json' },
      body: JSON.stringify(timezone === undefined ? account : { ...account, timezone }),
    });
    const rows = db.prepare('SELECT timezone FROM users').all() as { timezone: string }[];
    return { status: response.status, body: await response.json() as unknown, zones: rows.map((row) => row.timezone) };
  };

  assert.deepEqual((await attempt('europe/madrid')), { status: 200, body: { ok: true }, zones: ['Europe/Madrid'] });
  assert.deepEqual((await attempt('utc')), { status: 200, body: { ok: true }, zones: ['UTC'] });
  assert.deepEqual((await attempt(undefined)), { status: 200, body: { ok: true }, zones: ['UTC'] }, 'no timezone');
  assert.deepEqual((await attempt('')), { status: 200, body: { ok: true }, zones: ['UTC'] }, 'an empty timezone');
  for (const timezone of ['+02:00', '-0500', 'Bogus/Zone', 42]) {
    assert.deepEqual((await attempt(timezone)), { status: 400, body: 'Invalid timezone', zones: [] }, String(timezone));
  }
});

/** A cross-site form with enctype="text/plain" can post a JSON body, but it cannot set a CSRF header. */
const textPlain = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: JSON.stringify(body),
});

test('form login without the CSRF header is refused before the password check and charges no counter', async () => {
  const db = (await openDatabase(':memory:'));
  (await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' }));
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: { code: null } }));
  const login = (password: string, headers?: Record<string, string>) =>
    app.request('/api/app/login', textPlain({ email: 'me@example.com', password }, headers));
  const sessions = () => (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

  const refused = (await login(PASSWORD));
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Missing CSRF header');
  assert.equal(refused.headers.get('set-cookie'), null);
  // More than the account and address allowance: if any of these were charged, the logins below would get 429.
  for (let i = 0; i <= ACCOUNT_ADDRESS_LIMIT; i++) assert.equal((await login('wrong')).status, 403);
  assert.equal(sessions(), 0);

  const wrong = (await login('wrong', CSRF));
  assert.equal(wrong.status, 403);
  assert.equal(await wrong.json(), 'Incorrect email or password');
  for (const header of ['x-tokkl-csrf', 'x-timetrack-csrf']) {
    const ok = (await login(PASSWORD, { [header]: '1' }));
    assert.equal(ok.status, 200, header);
    assert.match(ok.headers.get('set-cookie') ?? '', /tokkl_session=/, header);
  }
  assert.equal(sessions(), 2);
});

test('setup without the CSRF header is refused before the code check and charges no counter', async () => {
  const db = (await openDatabase(':memory:'));
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: { code: 'ABCD-EFGH-JKLM' } }));
  const account = { email: 'owner@example.com', password: 'long enough', fullname: 'Owner' };
  const post = (setupCode: string, headers?: Record<string, string>) =>
    app.request('/api/app/setup', textPlain({ ...account, setup_code: setupCode }, headers));

  const refused = await post('ABCD-EFGH-JKLM');
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Missing CSRF header');
  assert.equal(refused.headers.get('set-cookie'), null);
  // More than the setup code allowance: if any of these were charged, the setup below would get 429.
  for (let i = 0; i <= SETUP_CODE_LIMIT; i++) assert.equal((await post('WRONG')).status, 403);
  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: true });

  const wrong = await post('WRONG', CSRF);
  assert.equal(wrong.status, 403);
  assert.match(await wrong.json() as string, /^Invalid setup code/);
  const ok = await post('ABCD-EFGH-JKLM', { 'x-timetrack-csrf': '1' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie') ?? '', /tokkl_session=/);
  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: false });
});

test('reset_token issues a new token and invalidates the old one', async () => {
  const ctx = (await setup());
  const reset = await ctx.json('POST', '/api/v9/me/reset_token');
  assert.equal(reset.status, 200);
  assert.match(reset.body, /^[0-9a-f]{32}$/);
  assert.equal((await ctx.request('GET', '/api/v9/me')).status, 403);
});

test('PUT /me changes the password only with the current one', async () => {
  const ctx = (await setup());
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

test('a password change through PUT /me replaces the API token and returns the new one', async () => {
  const ctx = (await setup());
  const old = ctx.user.apiToken;
  const changed = await ctx.json('PUT', '/api/v9/me', { current_password: PASSWORD, password: 'new password 1' });
  assert.equal(changed.status, 200, 'the old token can still make the change');
  const replacement = changed.body.api_token as string;
  assert.match(replacement, /^[0-9a-f]{32}$/);
  assert.notEqual(replacement, old);
  assert.equal((await getUser(ctx.db, ctx.user.id))!.apiToken, replacement, 'the response carries the stored token');

  const me = (token: string) => ctx.request('GET', '/api/v9/me', undefined, { authorization: basic(token, 'api_token') });
  assert.equal((await me(old)).status, 403, 'the old token stops working');
  const fresh = await me(replacement);
  assert.equal(fresh.status, 200, 'the new token signs in');
  assert.equal((await fresh.json() as { api_token: string }).api_token, replacement);
});

test('PUT /me without a password change keeps the exact API token', async () => {
  const ctx = (await setup());
  const updated = await ctx.json('PUT', '/api/v9/me', { timezone: 'Europe/Madrid' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.timezone, 'Europe/Madrid');
  assert.equal(updated.body.api_token, ctx.user.apiToken);

  const refused = await ctx.json('PUT', '/api/v9/me', { current_password: 'nope', password: 'new password 1' });
  assert.equal(refused.status, 400, 'a refused password change writes nothing either');

  assert.equal((await getUser(ctx.db, ctx.user.id))!.apiToken, ctx.user.apiToken);
  assert.equal((await ctx.request('GET', '/api/v9/me')).status, 200, 'the token still signs in');
});

test('PUT /me stores and returns the canonical timezone name', async () => {
  const ctx = (await setup());
  for (const [sent, stored] of [['europe/madrid', 'Europe/Madrid'], ['utc', 'UTC'], ['Etc/UTC', 'UTC']] as const) {
    const updated = await ctx.json('PUT', '/api/v9/me', { timezone: sent });
    assert.equal(updated.status, 200, sent);
    assert.equal(updated.body.timezone, stored, sent);
    assert.equal((await getUser(ctx.db, ctx.user.id))!.timezone, stored, sent);
    assert.equal((await ctx.json('GET', '/api/v9/me')).body.timezone, stored, sent);
  }
});

test('PUT /me refuses offset IDs and unknown timezones and changes nothing', async () => {
  const ctx = (await setup({ timezone: 'Europe/Madrid' }));
  const before = (await getUser(ctx.db, ctx.user.id))!;
  for (const timezone of ['+02:00', '-0500', '\u221205:00', 'Bogus/Zone']) {
    const refused = await ctx.json('PUT', '/api/v9/me', { timezone, fullname: 'Changed' });
    assert.equal(refused.status, 400, timezone);
    assert.equal(refused.body, 'Invalid timezone', timezone);
  }
  assert.deepEqual((await getUser(ctx.db, ctx.user.id)), before);
});

test('legacy schema version 5 is refused without modifying its data', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tokkl-refusal-')); const path=join(dir,'legacy.sqlite');
 try { const old=new DatabaseSync(path); old.function('canonical_time_zone',{deterministic:true},value=>value); for(const migration of MIGRATIONS.slice(0,5))old.exec(migration); old.exec('PRAGMA user_version=5'); old.close();
 const before=readFileSync(path); await assert.rejects(openDatabase(path),/unsupported-schema/); assert.deepEqual(readFileSync(path),before);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

/** createFirstAdmin refuses a second account, so tests that need one insert it directly. */
async function insertSecondUser(db: FixtureDatabase, owner: User, email: string): Promise<User> {
  const result = db.prepare(`
    INSERT INTO users (email, fullname, password_hash, api_token, timezone, default_workspace_id, preferences, created_at, updated_at)
    VALUES (?, '', ?, ?, 'UTC', ?, '{}', ?, ?)
  `).run(email, owner.passwordHash, generateApiToken(), owner.defaultWorkspaceId, owner.createdAt, owner.createdAt);
  return (await getUser(db, Number(result.lastInsertRowid)))!;
}

test('PUT /me refuses an email another user has, in any case, and allows recasing your own', async () => {
  const ctx = (await setup());
  const other = (await insertSecondUser(ctx.db, ctx.user, 'b@example.com'));
  const putAs = async (user: User, body: unknown) => {
    const response = await ctx.request('PUT', '/api/v9/me', body, { authorization: basic(user.apiToken, 'api_token') });
    return { status: response.status, body: await response.json() as any };
  };

  for (const email of ['me@example.com', 'ME@EXAMPLE.COM', '  Me@Example.com  ']) {
    const taken = (await putAs(other, { email, fullname: 'Renamed' }));
    assert.equal(taken.status, 400, email);
    assert.equal(taken.body, 'Email already in use');
    assert.equal((await getUser(ctx.db, other.id))!.email, 'b@example.com', 'the email is unchanged');
    assert.equal((await getUser(ctx.db, other.id))!.fullName, '', 'nothing else is written either');
  }

  const recased = (await putAs(ctx.user, { email: 'Me@Example.COM' }));
  assert.equal(recased.status, 200);
  assert.equal(recased.body.email, 'Me@Example.COM');
  assert.equal((await getUser(ctx.db, ctx.user.id))!.email, 'Me@Example.COM');
  assert.equal((await putAs(other, { email: 'b@example.com' })).status, 200, 'resending your own email is fine');
});

test('behind a trusted proxy the rate limit keys on the last X-Forwarded-For hop', async () => {
  const { createApp: create } = await import('../src/app.ts');
  const { openDatabase: open } = await import('./fixtures/database.ts');
  const { createFirstAdmin } = await import('./fixtures/domain.ts');
  const db = await open(':memory:');
  (await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' }));
  const app = testServer(create({ storage: storageFor(db), config: { ...testConfig(), trustProxy: true }, setup: { code: null } }));
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const response = await app.request('/api/app/login', {
      method: 'POST',
      headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}, 192.168.1.50` },
      body: JSON.stringify({ email: 'me@example.com', password: 'wrong' }),
    });
    last = response.status;
  }
  assert.equal(last, 429, 'a spoofed leftmost entry must not reset the limit');
});

test('bad since and bad report dates are 400, not 500', async () => {
  const ctx = (await setup());
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
  const db = (await openDatabase(':memory:'));
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: { code: 'ABCD-EFGH-JKLM' } }));
  const post = (password: string) => app.request('/api/app/setup', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password, fullname: 'Owner', setup_code: 'ABCD-EFGH-JKLM' }),
  });

  const tooLong = await post('x'.repeat(MAX_PASSWORD_LENGTH + 1));
  assert.equal(tooLong.status, 400);
  assert.equal(await tooLong.json(), `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  assert.deepEqual(await (await app.request('/api/app/status')).json(), { setup_required: true });

  const longest = 'y'.repeat(MAX_PASSWORD_LENGTH);
  assert.equal((await post(longest)).status, 200);
  const login = await app.request('/api/app/login', {
    method: 'POST', headers: { ...CSRF, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: longest }),
  });
  assert.equal(login.status, 200);
});

test('an owner with a password over the cap can still log in and rotate it', async () => {
  const db = (await openDatabase(':memory:'));
  const legacy = 'L'.repeat(MAX_PASSWORD_LENGTH * 2);
  const user = (await insertAccount(db, { email: 'me@example.com', passwordHash: await hashPassword(legacy), role:'admin', fullname: '', timezone: 'UTC' }));
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(), setup: { code: null } }));
  const put = (body: unknown) => app.request('/api/v9/me', {
    method: 'PUT',
    headers: { authorization: basic(user.apiToken, 'api_token'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const login = await app.request('/api/app/login', {
    method: 'POST', headers: { ...CSRF, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'me@example.com', password: legacy }),
  });
  assert.equal(login.status, 200);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', legacy) } })).status, 200);

  const newTooLong = await put({ current_password: legacy, password: 'n'.repeat(MAX_PASSWORD_LENGTH + 1) });
  assert.equal(newTooLong.status, 400);
  assert.equal(await newTooLong.json(), `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);

  assert.equal((await put({ current_password: legacy, password: 'new password 1' })).status, 200);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', legacy) } })).status, 403);
  assert.equal((await app.request('/api/v9/me', { headers: { authorization: basic('me@example.com', 'new password 1') } })).status, 200);
});

test('twelve parallel wrong passwords across login, Basic auth and password change run at most ten checks', async () => {
  const ctx = (await setup());
  const kinds = ['login', 'basic', 'change'] as const;
  const wrong = (kind: (typeof kinds)[number]) => {
    if (kind === 'login') {
      return ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: 'wrong' }, { authorization: '', ...CSRF });
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
  const right = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '', ...CSRF });
  assert.equal(right.status, 429);
  assert.equal((await ctx.request('GET', '/api/v9/me')).status, 200);
});

test('a successful login resets the failure count', async () => {
  const ctx = (await setup());
  const login = (password: string) => ctx.request('POST', '/api/app/login', { email: 'me@example.com', password }, { authorization: '', ...CSRF });
  for (let i = 0; i < 9; i++) assert.equal((await login('wrong')).status, 403);
  assert.equal((await login(PASSWORD)).status, 200);

  const afterReset = await Promise.all(Array.from({ length: 10 }, async () => (await login('wrong'))));
  assert.deepEqual(afterReset.map((response) => response.status), Array(10).fill(403));
  assert.equal((await login('wrong')).status, 429);
});

test('wrong API tokens are not counted as password failures', async () => {
  const ctx = (await setup());
  for (let i = 0; i < 12; i++) {
    const response = await ctx.request('GET', '/api/v9/me', undefined, { authorization: basic('deadbeef', 'api_token') });
    assert.equal(response.status, 403);
  }
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '', ...CSRF });
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

test('FailureLimiter charges every counter, refuses when any is full and resets only the keys given', async () => {
  const limiter = new FailureLimiter(100, 15 * 60 * 1000);
  const small = { key: 'small', limit: 2 };
  const large = { key: 'large', limit: 5 };
  let checks = 0;
  const failingCheck = async () => {
    checks++;
    await new Promise((resolve) => setImmediate(resolve));
    return false;
  };

  const parallel = await Promise.all(Array.from({ length: 4 }, () => limiter.attempt([small, large], failingCheck)));
  assert.deepEqual(parallel, [false, false, null, null], 'the smaller counter caps the parallel checks');
  assert.equal(checks, 2);
  assert.equal(limiter.isBlocked([small]), true);
  assert.equal(limiter.isBlocked([large]), false);

  // The larger counter still holds the two failures charged with the smaller one.
  limiter.reset([small]);
  for (let i = 0; i < 3; i++) await limiter.attempt([{ key: 'other', limit: 10 }, large], failingCheck);
  assert.equal(await limiter.attempt([small, large], async () => true), null, 'blocked by the larger counter alone');
  assert.equal(checks, 5);
});

test('normalizeEmail and passwordCounters key accounts by trimmed, ASCII-lowercased email and keep pairs apart', () => {
  assert.equal(normalizeEmail('  Me@Example.COM '), 'me@example.com');
  assert.equal(normalizeEmail('Äß@EXAMPLE.com'), 'Äß@example.com', 'only ASCII is folded, as SQLite NOCASE does');
  assert.notEqual(passwordCounters('Ä@example.com', 'x')[1]!.key, passwordCounters('ä@example.com', 'x')[1]!.key);
  assert.deepEqual(passwordCounters(' ME@example.com', '1.2.3.4'), passwordCounters('me@example.com', '1.2.3.4'));
  assert.deepEqual(passwordCounters('a@b', '1.2.3.4').map(({ limit }) => limit), [10, 50, 100]);
  assert.deepEqual(accountCounters('a@b', '1.2.3.4'), passwordCounters('a@b', '1.2.3.4').slice(0, 2));
  // An email and address that share a joined spelling still get different pair keys.
  const [left] = passwordCounters('a@b:c', 'd');
  const [right] = passwordCounters('a@b', 'c:d');
  assert.notEqual(left!.key, right!.key);
});

/** An app behind a trusted proxy, so each request can pick its client address. */
async function multiUserApp(count: number, names = Array.from({ length: count }, (_, i) => `user${i}@example.com`)) {
  const db = (await openDatabase(':memory:'));
  const owner = (await createFirstAdmin(db, { email: names[0]!, password: PASSWORD, fullname: '', timezone: 'UTC' }));
  const users = [owner, ...await Promise.all(names.slice(1).map(name => insertSecondUser(db, owner, name)))];
  const emails = users.map((user) => user.email);
  const app = testServer(createApp({ storage: storageFor(db), config: { ...testConfig(), trustProxy: true }, setup: { code: null } }));
  const login = async (email: string, password: string, address = '10.0.0.1') => (await app.request('/api/app/login', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': address },
    body: JSON.stringify({ email, password }),
  })).status;
  /** A password change signed in with `user`'s API token, so only current_password is checked. */
  const changePassword = async (user: User, current: string, address = '10.0.0.1') => (await app.request('/api/v9/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address, authorization: basic(user.apiToken, 'api_token') },
    body: JSON.stringify({ current_password: current, password: 'new password 1' }),
  })).status;
  return { app, db, users, emails, login, changePassword };
}

test('one account signing in from an address does not reset failures against another', async () => {
  const { login } = (await multiUserApp(2));
  for (let i = 0; i < 9; i++) assert.equal((await login('user1@example.com', 'wrong')), 403);
  assert.equal((await login('user0@example.com', PASSWORD)), 200);
  assert.equal((await login('user1@example.com', 'wrong')), 403, 'the tenth failure');
  assert.equal((await login('user1@example.com', PASSWORD)), 429, 'still counted from the earlier nine');
});

test('accounts share failure counters only when the database matches their emails', async () => {
  // users.email is COLLATE NOCASE, which folds ASCII only, so these are two accounts.
  const { login } = (await multiUserApp(2, ['Ä@example.com', 'ä@example.com']));
  for (let i = 0; i < 10; i++) assert.equal((await login('ä@example.com', 'wrong')), 403);
  assert.equal((await login('ä@example.com', PASSWORD)), 429);
  assert.equal((await login('Ä@example.com', PASSWORD)), 200, 'failures against the other account are not counted');

  // ASCII case is folded by both, so these are one account.
  const ascii = (await multiUserApp(1, ['a@example.com']));
  for (let i = 0; i < 10; i++) assert.equal(await ascii.login(' A@EXAMPLE.COM', 'wrong'), 403);
  assert.equal(await ascii.login('a@example.com', PASSWORD), 429);
});

test('failures against one account from many addresses are refused after 50', async () => {
  const { login } = (await multiUserApp(1));
  // Five per address, so no address comes near its own limits. All 50 fit under every limit, so
  // they run in parallel.
  const spread = (email: string, subnet: number) => Promise.all(
    Array.from({ length: 50 }, async (_, i) => (await login(email, 'wrong', `10.${subnet}.${Math.floor(i / 5)}.1`))),
  );
  assert.deepEqual(await spread('user0@example.com', 1), Array(50).fill(403));
  assert.equal((await login('user0@example.com', PASSWORD, '10.9.9.9')), 429);
  // Unknown emails are counted the same way.
  assert.deepEqual(await spread(' Ghost@Example.com', 2), Array(50).fill(403));
  assert.equal((await login('ghost@example.com', 'wrong', '10.9.9.9')), 429);
});

test('ten users behind one address each failing five times can all still sign in', async () => {
  const { emails, login } = (await multiUserApp(10));
  const failures = await Promise.all(emails.flatMap((email) => Array.from({ length: 5 }, async () => (await login(email, 'wrong')))));
  assert.deepEqual(failures, Array(50).fill(403));
  for (const email of emails) assert.equal((await login(email, PASSWORD)), 200, email);
});

test("wrong current passwords in a password change count against the caller's account", async () => {
  const { db, users, login, changePassword } = (await multiUserApp(2));
  const [caller, other] = users as [User, User];

  for (let i = 0; i < 10; i++) assert.equal((await changePassword(caller, 'wrong')), 400);
  assert.equal((await changePassword(caller, PASSWORD)), 429, 'the account is blocked from this address');
  assert.equal((await login(caller.email, PASSWORD)), 429);
  assert.equal((await login(other.email, PASSWORD)), 200, 'another account at the same address is not');

  // Forty more from other addresses, five each, reach the account's limit of 50.
  const spread = await Promise.all(Array.from({ length: 40 }, async (_, i) => (await changePassword(caller, 'wrong', `10.1.${Math.floor(i / 5)}.1`))));
  assert.deepEqual(spread, Array(40).fill(400));
  assert.equal((await login(caller.email, PASSWORD, '10.9.9.9')), 429, 'refused from an address it never failed from');
  assert.equal((await login(other.email, PASSWORD, '10.9.9.9')), 200);
  assert.equal((await getUser(db, caller.id))!.passwordHash, caller.passwordHash, 'no change went through');
});

test('one address is refused after 100 failures across accounts, and a success does not clear it', async () => {
  const { login } = (await multiUserApp(1));
  const failures = await Promise.all(Array.from({ length: 99 }, async (_, i) => (await login(`nobody${Math.floor(i / 5)}@example.com`, 'wrong'))));
  assert.deepEqual(failures, Array(99).fill(403));
  assert.equal((await login('user0@example.com', PASSWORD)), 200);
  assert.equal((await login('nobody-else@example.com', 'wrong')), 403, 'the hundredth failure');
  assert.equal((await login('user0@example.com', PASSWORD)), 429);
  assert.equal((await login('user0@example.com', PASSWORD, '10.0.0.2')), 200, 'other addresses are unaffected');
});

test('setup codes have their own per-address limit of ten', async () => {
  const db = (await openDatabase(':memory:'));
  const app = testServer(createApp({ storage: storageFor(db), config: { ...testConfig(), trustProxy: true }, setup: { code: 'ABCD-EFGH-JKLM' } }));
  const post = (path: string, body: unknown, address = '10.0.0.1') => app.request(path, {
    method: 'POST', headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': address }, body: JSON.stringify(body),
  });
  const account = { email: 'owner@example.com', password: 'long enough' };

  // Password failures from the address do not use up its setup allowance.
  const logins = await Promise.all(Array.from({ length: 20 }, (_, i) => post('/api/app/login', { email: `x${i}@example.com`, password: 'wrong' })));
  assert.deepEqual(logins.map((response) => response.status), Array(20).fill(403));
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/app/setup', { ...account, setup_code: 'WRONG' })).status, 403);
  assert.equal((await post('/api/app/setup', { ...account, setup_code: 'ABCD-EFGH-JKLM' })).status, 429);
  assert.equal((await post('/api/app/setup', { ...account, setup_code: 'ABCD-EFGH-JKLM' }, '10.0.0.2')).status, 200);
});

test('logout with a wrong CSRF value keeps the session; no or stale session logout is 200', async () => {
  const ctx = (await setup());
  const login = await ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '', ...CSRF });
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
  const ctx = (await setup());
  const signIn = () => ctx.request('POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD }, { authorization: '', ...CSRF });
  const login = await signIn();
  const issued = login.headers.getSetCookie();
  assert.ok(issued.some((cookie) => /^tokkl_session=[^;]+;/.test(cookie)), 'login issues the new cookie');
  assert.ok(issued.some((cookie) => /^tt_session=;/.test(cookie)), 'login clears the old cookie');
  const token = issued.find((cookie) => cookie.startsWith('tokkl_session='))!.split(';')[0]!.split('=')[1]!;
  const legacy = `tt_session=${token}`;
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    ctx.request(method, path, body, { authorization: '', ...headers });
  const entry = { start: new Date().toISOString(), duration: 600, created_with: 'test' };
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
  const change = (await call('PUT', '/api/v9/me', { cookie: legacy, 'x-timetrack-csrf': '1' }, { current_password: PASSWORD, password: 'new password 1' }));
  assert.equal(change.status, 200);
  assert.equal((await call('GET', '/api/v9/me', { cookie: legacy })).status, 200, 'the changing session stays');
  assert.equal((await call('GET', '/api/v9/me', { cookie: other })).status, 403, 'other sessions end');

  assert.equal((await call('POST', '/api/app/logout', { cookie: legacy })).status, 403, 'logout of an old-cookie session needs the header');
  const logout = (await call('POST', '/api/app/logout', { cookie: legacy, 'x-timetrack-csrf': '1' }));
  assert.equal(logout.status, 200);
  const cleared = logout.headers.getSetCookie();
  assert.ok(cleared.some((cookie) => cookie.startsWith('tokkl_session=;')));
  assert.ok(cleared.some((cookie) => cookie.startsWith('tt_session=;')));
  assert.equal((await call('GET', '/api/v9/me', { cookie: legacy })).status, 403, 'logout ended the session');
});

const WINDOW_SECONDS = 15 * 60;
const retryAfter = (response: Response) => response.headers.get('retry-after');

test('FailureLimiter.retryAfterSeconds rounds up, uses the latest full counter and stays within the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const limiter = new FailureLimiter(100, 15 * 60 * 1000);
  const early = { key: 'early', limit: 2 };
  const late = { key: 'late', limit: 2 };
  const fail = async () => false;

  await limiter.attempt([early], fail);
  t.mock.timers.tick(100_000);
  await limiter.attempt([early, late], fail);
  await limiter.attempt([late], fail);
  assert.equal(limiter.isBlocked([early]), true);
  assert.equal(limiter.isBlocked([late]), true);

  assert.equal(limiter.retryAfterSeconds([early]), WINDOW_SECONDS - 100);
  assert.equal(limiter.retryAfterSeconds([late]), WINDOW_SECONDS);
  assert.equal(limiter.retryAfterSeconds([late, early]), WINDOW_SECONDS, 'the latest full counter');
  assert.equal(limiter.retryAfterSeconds([early, late]), WINDOW_SECONDS, 'whatever the order');
  assert.equal(limiter.retryAfterSeconds([{ key: 'free', limit: 2 }, late]), WINDOW_SECONDS);

  t.mock.timers.tick(1);
  assert.equal(limiter.retryAfterSeconds([early]), WINDOW_SECONDS - 100, 'a partial second rounds up');
  t.mock.timers.tick(WINDOW_SECONDS * 1000 - 100_001 - 1);
  assert.equal(limiter.retryAfterSeconds([early]), 1, 'never below one second');

  t.mock.timers.tick(1);
  assert.equal(await limiter.attempt([early], async () => true), true, 'the wait frees the counter');
});

test('FailureLimiter gives one second to an attempt refused only because the waiting queue is full', async () => {
  const limiter = new FailureLimiter(2, 15 * 60 * 1000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const slow = async () => { await held; return false; };
  const queued = Array.from({ length: 5 }, () => limiter.attempt('addr', slow));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(limiter.isBlocked('addr'), false);
  assert.equal(limiter.retryAfterSeconds('addr'), 1);
  release();
  await Promise.all(queued);
});

test('login, Basic auth and password-change 429s carry Retry-After, and waiting that long frees the counter', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { app, users, login } = (await multiUserApp(1));
  const [owner] = users as [User];
  const loginResponse = () => app.request('/api/app/login', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ email: owner.email, password: PASSWORD }),
  });
  const basicResponse = () => app.request('/api/v9/me', {
    headers: { 'x-forwarded-for': '10.0.0.1', authorization: basic(owner.email, PASSWORD) },
  });
  const changeResponse = () => app.request('/api/v9/me', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', authorization: basic(owner.apiToken, 'api_token') },
    body: JSON.stringify({ current_password: PASSWORD, password: 'new password 1' }),
  });

  for (let i = 0; i < 10; i++) assert.equal((await login(owner.email, 'wrong')), 403);
  t.mock.timers.tick(1_500);

  for (const [name, send] of [['login', loginResponse], ['basic', basicResponse], ['change', changeResponse]] as const) {
    const response = (await send());
    assert.equal(response.status, 429, name);
    assert.equal(retryAfter(response), String(WINDOW_SECONDS - 1), `${name}: 898.5 seconds left, rounded up`);
    assert.match(await response.text(), /Too many failed/, `${name}: the body is unchanged`);
  }

  t.mock.timers.tick((WINDOW_SECONDS - 1) * 1000);
  assert.equal((await basicResponse()).status, 200, 'the counter is free after the advertised wait');
  assert.equal((await loginResponse()).status, 200);
});

test('a 429 from the address counter alone carries Retry-After for that counter', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { app, login } = (await multiUserApp(1));
  // One hundred failures across accounts fill only the address counter.
  await Promise.all(Array.from({ length: 100 }, async (_, i) => (await login(`nobody${Math.floor(i / 5)}@example.com`, 'wrong'))));
  t.mock.timers.tick(30_000);
  const response = await app.request('/api/app/login', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ email: 'user0@example.com', password: PASSWORD }),
  });
  assert.equal(response.status, 429);
  assert.equal(retryAfter(response), String(WINDOW_SECONDS - 30));
});

test('with two full counters, waiting the advertised Retry-After lets the next login through', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { app, login } = (await multiUserApp(1));
  // Nine failures each for ten unknown accounts start the address counter without filling any account counter.
  const early = await Promise.all(Array.from({ length: 90 }, async (_, i) => (await login(`nobody${i % 10}@example.com`, 'wrong'))));
  assert.deepEqual(new Set(early), new Set([403]));
  t.mock.timers.tick(60_000);
  // A minute later, ten failures for user0 fill its account+address counter and the address counter.
  const late = await Promise.all(Array.from({ length: 10 }, async () => (await login('user0@example.com', 'wrong'))));
  assert.deepEqual(new Set(late), new Set([403]));
  const send = () => app.request('/api/app/login', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ email: 'user0@example.com', password: PASSWORD }),
  });

  const refused = (await send());
  assert.equal(refused.status, 429);
  const wait = Number(retryAfter(refused));
  assert.equal(wait, WINDOW_SECONDS, 'until the account+address counter, which resets a minute after the address counter');
  t.mock.timers.tick((wait - 60) * 1000);
  assert.equal((await send()).status, 429, 'the address counter alone has room by now');
  t.mock.timers.tick(60_000);
  assert.equal((await send()).status, 200, 'the advertised wait frees every counter');
});

test('setup 429s carry Retry-After, and waiting that long allows another code', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const db = (await openDatabase(':memory:'));
  const app = testServer(createApp({ storage: storageFor(db), config: { ...testConfig(), trustProxy: true }, setup: { code: 'ABCD-EFGH-JKLM' } }));
  const post = (setupCode: string) => app.request('/api/app/setup', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'long enough', setup_code: setupCode }),
  });

  for (let i = 0; i < 10; i++) assert.equal((await post('WRONG')).status, 403);
  t.mock.timers.tick(250);
  const refused = await post('ABCD-EFGH-JKLM');
  assert.equal(refused.status, 429);
  assert.equal(retryAfter(refused), String(WINDOW_SECONDS));
  assert.match(await refused.text(), /Too many failed/);

  t.mock.timers.tick(WINDOW_SECONDS * 1000 - 250);
  assert.equal((await post('ABCD-EFGH-JKLM')).status, 200);
});
