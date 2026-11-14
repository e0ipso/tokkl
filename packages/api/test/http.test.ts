import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { storageFor } from './fixtures/database.ts';
import { createApp } from './fixtures/app.ts';
import { openDatabase } from './fixtures/database.ts';
import { createFirstAdmin } from './fixtures/domain.ts';
import { CSRF, PASSWORD, setup, testConfig, testServer } from './helpers.ts';

test('JSON bodies work without a Content-Type header, as some Toggl clients send them', async () => {
  const ctx = await setup();
  const response = await ctx.request(
    'POST',
    `/api/v9/workspaces/${ctx.wid}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 600 },
    { 'content-type': '' },
  );
  assert.equal(response.status, 200);
  const identity = await ctx.request(
    'POST',
    `/api/v9/workspaces/${ctx.wid}/time_entries`,
    { start: '2026-10-01T09:00:00Z', duration: 600 },
    { 'content-type': '', 'content-encoding': 'Identity' },
  );
  assert.equal(identity.status, 200);
});

test('encoded bodies get a 415 before any decompression stream exists', async t => {
  const decompressors = [
    'createGunzip',
    'createInflate',
    'createInflateRaw',
    'createUnzip',
    'createBrotliDecompress',
    'createZstdDecompress',
  ] as const;
  const created = decompressors.map(name => t.mock.method(zlib, name));
  const db = await openDatabase();
  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(db), setup: { code: null } }));
  const post = (encoding: string, body: Uint8Array | string) =>
    app.request('/api/v9/does-not-exist', { method: 'POST', headers: { 'content-encoding': encoding }, body });
  const payload = Buffer.from('{"description":"x"}');
  // A gzip frame followed by null bytes once made the inflating parser throw outside the request.
  const crash = await post('gzip', Buffer.concat([zlib.gzipSync(payload), Buffer.alloc(32)]));
  assert.equal(crash.status, 415);
  assert.equal(await crash.json(), 'Unsupported content encoding');
  for (const [encoding, body] of [
    ['deflate', zlib.deflateSync(payload)],
    ['br', zlib.brotliCompressSync(payload)],
    ['x-unknown', 'plain'],
  ] as const)
    assert.equal((await post(encoding, body)).status, 415, encoding);
  for (const mock of created) assert.equal(mock.mock.callCount(), 0);
  assert.equal((await app.request('/healthz')).status, 200);
});

test('oversized bodies get a 413 with a Toggl-style string error', async () => {
  const ctx = await setup();
  const big = JSON.stringify({ description: 'x'.repeat(1_100_000) });
  const response = await ctx.request('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, big);
  assert.equal(response.status, 413);
  assert.equal(await response.json(), 'Request body too large');
});

test('an import checks the credential and the CSRF header before it reads a body', async () => {
  const ctx = await setup();
  const huge = 'x'.repeat(51 * 1024 * 1024);
  const anonymous = await ctx.request('POST', '/api/app/import/json', huge, { authorization: '', ...CSRF });
  assert.equal(anonymous.status, 403);
  assert.equal(await anonymous.json(), 'Incorrect username and/or password');
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  const noCsrf = await ctx.request('POST', '/api/app/import/toggl-csv', huge, { authorization: '' });
  assert.equal(noCsrf.status, 403);
  assert.equal(await noCsrf.json(), 'Missing CSRF header');
  // A signed-in import may be large, up to its own limit.
  const oversize = await ctx.request('POST', '/api/app/import/json', huge);
  assert.equal(oversize.status, 413);
  assert.equal(await oversize.json(), 'Request body too large');
  const large = await ctx.request('POST', '/api/app/import/json', JSON.stringify({ pad: 'x'.repeat(1_100_000) }));
  assert.equal(large.status, 400);
  assert.equal(large.headers.get('cache-control'), 'no-store');
});

test('behind a trusted HTTPS proxy the session cookie is Secure and HSTS is sent', async () => {
  const db = await openDatabase();
  await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' });
  const login = (app: ReturnType<typeof testServer>) =>
    app.request('/api/app/login', {
      method: 'POST',
      headers: {
        ...CSRF,
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '192.168.1.20',
      },
      body: JSON.stringify({ email: 'me@example.com', password: PASSWORD }),
    });

  const proxied = await login(
    testServer(
      createApp({ storage: storageFor(db), config: { ...testConfig(db), trustProxy: 1 }, setup: { code: null } }),
    ),
  );
  assert.equal(proxied.status, 200);
  assert.match(proxied.headers.get('set-cookie') ?? '', /;\s*Secure/i);
  assert.match(proxied.headers.get('strict-transport-security') ?? '', /max-age=/);

  // Without TOKKL_TRUST_PROXY the forwarded headers are ignored.
  const direct = await login(
    testServer(createApp({ storage: storageFor(db), config: testConfig(db), setup: { code: null } })),
  );
  assert.doesNotMatch(direct.headers.get('set-cookie') ?? '', /;\s*Secure/i);
  assert.equal(direct.headers.get('strict-transport-security'), null);
  assert.equal(direct.headers.get('x-powered-by'), null);
});
