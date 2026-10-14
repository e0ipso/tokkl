import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db/index.ts';
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
  assert.match(cookie, /tt_session=/);
  assert.match(cookie, /HttpOnly/);
  const session = cookie.split(';')[0]!;

  const read = await ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: session });
  assert.equal(read.status, 200);

  const body = { start: new Date().toISOString(), duration: -1, created_with: 'test' };
  const noCsrf = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, body, { authorization: '', cookie: session });
  assert.equal(noCsrf.status, 403);
  const withCsrf = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, body, {
    authorization: '', cookie: session, 'x-timetrack-csrf': '1',
  });
  assert.equal(withCsrf.status, 200);

  const logout = await ctx.request('POST', '/api/app/logout', undefined, { authorization: '', cookie: session });
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
  assert.match(ok.headers.get('set-cookie') ?? '', /tt_session=/);
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
