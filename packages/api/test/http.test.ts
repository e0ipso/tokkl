import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/db/index.ts';
import { createFirstAdmin } from '../src/models/users.ts';
import { PASSWORD, setup, testConfig, testServer } from './helpers.ts';

test('JSON bodies work without a Content-Type header, as some Toggl clients send them', async () => {
  const ctx = await setup();
  const response = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 60 }, { 'content-type': '' });
  assert.equal(response.status, 200);
});

test('oversized bodies get a 413 with a Toggl-style string error', async () => {
  const ctx = await setup();
  const big = JSON.stringify({ description: 'x'.repeat(1_100_000) });
  const response = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, big);
  assert.equal(response.status, 413);
  assert.equal(await response.json(), 'Request body too large');
});

test('behind a trusted HTTPS proxy the session cookie is Secure and HSTS is sent', async () => {
  const db = openDatabase(':memory:');
  await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' });
  const login = (app: ReturnType<typeof testServer>) => app.request('/api/app/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.168.1.20' },
    body: JSON.stringify({ email: 'me@example.com', password: PASSWORD }),
  });

  const proxied = await login(testServer(createApp({ db, config: { ...testConfig(), trustProxy: true }, setup: { code: null } })));
  assert.equal(proxied.status, 200);
  assert.match(proxied.headers.get('set-cookie') ?? '', /;\s*Secure/i);
  assert.match(proxied.headers.get('strict-transport-security') ?? '', /max-age=/);

  // Without TOKKL_TRUST_PROXY the forwarded headers are ignored.
  const direct = await login(testServer(createApp({ db, config: testConfig(), setup: { code: null } })));
  assert.doesNotMatch(direct.headers.get('set-cookie') ?? '', /;\s*Secure/i);
  assert.equal(direct.headers.get('strict-transport-security'), null);
  assert.equal(direct.headers.get('x-powered-by'), null);
});
