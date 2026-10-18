import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_LIMIT } from '../src/auth/rateLimit.ts';
import { INVITE_NOT_FOUND } from '../src/models/accountTokens.ts';
import { addUser, CSRF, setup, type TestContext } from './helpers.ts';

const DAY_MS = 86_400_000;
const NEW_PASSWORD = 'invited person 1';

async function invite(admin: TestContext, body: Record<string, unknown> = { role: 'user' }) {
  const response = await admin.request('POST', '/api/app/admin/invites', body);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const created = JSON.parse(text) as { id: number; url: string; expires_at: string; created_at: string };
  return { ...created, token: created.url.replace(/^\/invite\//, ''), text };
}

/** A request without the admin's API token, as a logged-out browser sends it. */
const anonymous = (ctx: TestContext, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  ctx.request(method, path, body, { authorization: '', ...headers });

const accept = (ctx: TestContext, token: string, account: Record<string, unknown>) =>
  anonymous(ctx, 'POST', `/api/app/invites/${token}`, { password: NEW_PASSWORD, timezone: 'Europe/Madrid', ...account }, CSRF);

const counts = (ctx: TestContext) => ({
  ...(ctx.db.prepare(`
    SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM workspaces) AS workspaces,
           (SELECT COUNT(*) FROM workspace_users) AS memberships,
           (SELECT COUNT(*) FROM account_tokens WHERE used_at IS NOT NULL) AS used
  `).get() as Record<string, number>),
});

test('an admin creates an invite, sees its URL once, and lists it without the token', async () => {
  const admin = await setup();
  const created = await invite(admin, { role: 'admin', note: '  For Ana  ' });
  assert.match(created.url, /^\/invite\/[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.equal(new Set([created.token, (await invite(admin)).token]).size, 2);

  const stored = admin.db.prepare('SELECT * FROM account_tokens WHERE id = ?').get(created.id) as Record<string, unknown>;
  assert.notEqual(stored.token_hash, created.token, 'only the hash is stored');
  assert.equal(stored.note, 'For Ana');
  assert.equal(stored.created_by, admin.user.id);

  const list = await admin.request('GET', '/api/app/admin/invites');
  assert.equal(list.status, 200);
  const text = await list.text();
  assert.ok(!text.includes(created.token), 'the list never carries the token');
  assert.ok(!text.includes(String(stored.token_hash)), 'nor its hash');
  const listed = JSON.parse(text) as Array<Record<string, unknown>>;
  assert.equal(listed.length, 2);
  assert.deepEqual(Object.keys(listed[0]!).sort(), ['created_at', 'created_by', 'expires_at', 'id', 'note', 'role']);
  assert.deepEqual({ ...listed[0], created_at: undefined, expires_at: undefined }, {
    id: created.id, role: 'admin', note: 'For Ana', created_by: admin.user.id, created_at: undefined, expires_at: undefined,
  });

  for (const body of [{}, { role: 'owner' }, { role: 'user', note: 5 }, { role: 'user', note: 'x'.repeat(256) }]) {
    assert.equal((await admin.request('POST', '/api/app/admin/invites', body)).status, 400, JSON.stringify(body));
  }
});

test('a new invite expires after the stored invite_days', async () => {
  const admin = await setup();
  const lifetime = (created: { created_at: string; expires_at: string }) =>
    Date.parse(created.expires_at) - Date.parse(created.created_at);
  // Toggl timestamps drop milliseconds, so allow one second either way.
  assert.ok(Math.abs(lifetime(await invite(admin)) - 7 * DAY_MS) <= 1000, 'seven days by default');
  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { invite_days: 3 })).status, 200);
  const created = await invite(admin);
  assert.ok(Math.abs(lifetime(created) - 3 * DAY_MS) <= 1000);
  const row = admin.db.prepare('SELECT created_at, expires_at FROM account_tokens WHERE id = ?').get(created.id) as Record<string, string>;
  assert.equal(Date.parse(row.expires_at!) - Date.parse(row.created_at!), 3 * DAY_MS);
});

test('a regular user gets 403 from every admin invite route', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const created = await invite(admin);
  for (const [method, path, body] of [
    ['POST', '/api/app/admin/invites', { role: 'admin' }],
    ['GET', '/api/app/admin/invites', undefined],
    ['DELETE', `/api/app/admin/invites/${created.id}`, undefined],
  ] as const) {
    assert.equal((await bob.request(method, path, body)).status, 403, `${method} ${path}`);
  }
  assert.equal((await admin.json('GET', '/api/app/admin/invites')).body.length, 1, 'nothing was revoked or added');
});

test('accepting an invite creates the account, its workspace and membership, and signs it in', async () => {
  const admin = await setup();
  const created = await invite(admin, { role: 'admin' });
  const check = await anonymous(admin, 'GET', `/api/app/invites/${created.token}`);
  assert.equal(check.status, 200);
  assert.deepEqual(await check.json(), { role: 'admin' });

  const response = await accept(admin, created.token, { email: 'ana@example.com', fullname: '  Ana  ' });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^tokkl_session=[^;]+;.*HttpOnly/i);
  const session = cookie.split(';')[0]!;

  const user = admin.db.prepare("SELECT * FROM users WHERE email = 'ana@example.com'").get() as Record<string, unknown>;
  assert.equal(user.role, 'admin', 'the invite role');
  assert.equal(user.fullname, 'Ana');
  assert.equal(user.timezone, 'Europe/Madrid');
  const workspace = admin.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(Number(user.default_workspace_id)) as Record<string, unknown>;
  assert.equal(workspace.name, 'Ana workspace');
  assert.deepEqual(
    admin.db.prepare('SELECT workspace_id, role FROM workspace_users WHERE user_id = ?').all(Number(user.id)).map((row) => ({ ...row })),
    [{ workspace_id: workspace.id, role: 'owner' }],
  );
  const token = admin.db.prepare('SELECT used_at, user_id FROM account_tokens WHERE id = ?').get(created.id) as Record<string, unknown>;
  assert.ok(token.used_at);
  assert.equal(token.user_id, user.id);

  const me = await anonymous(admin, 'GET', '/api/v9/me', undefined, { cookie: session });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { email: string }).email, 'ana@example.com');

  // Every app report reads the new account's default workspace.
  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };
  for (const path of ['/api/app/report', '/api/app/report/weekly', '/api/app/report/entries', '/api/app/report/detailed.csv',
    '/api/app/report/summary.csv']) {
    const report = await anonymous(admin, 'POST', path, range, { cookie: session, 'x-tokkl-csrf': '1' });
    assert.equal(report.status, 200, path);
  }
  assert.equal((await admin.json('GET', '/api/app/admin/invites')).body.length, 0, 'a used invite is no longer pending');

  // With no name, the workspace is "My workspace", as for the first admin.
  const unnamed = await invite(admin);
  assert.equal((await accept(admin, unnamed.token, { email: 'nameless@example.com' })).status, 200);
  const nameless = admin.db.prepare(`
    SELECT users.role, workspaces.name FROM users JOIN workspaces ON workspaces.id = users.default_workspace_id
    WHERE email = 'nameless@example.com'
  `).get() as Record<string, unknown>;
  assert.deepEqual({ ...nameless }, { role: 'user', name: 'My workspace' });
});

test('accepting an invite stores the canonical timezone, refuses invalid and offset ones, and defaults to UTC', async () => {
  const admin = await setup();
  const zoneOf = (email: string) => (admin.db.prepare('SELECT timezone FROM users WHERE email = ?').get(email) as { timezone: string }).timezone;

  const created = await invite(admin);
  const before = counts(admin);
  for (const timezone of ['+02:00', '-0500', 'Bogus/Zone']) {
    const refused = await accept(admin, created.token, { email: 'ana@example.com', timezone });
    assert.equal(refused.status, 400, timezone);
    assert.equal(await refused.json(), 'Invalid timezone', timezone);
    assert.equal(refused.headers.get('set-cookie'), null, timezone);
  }
  assert.deepEqual(counts(admin), before, 'no account was created');
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com', timezone: 'europe/madrid' })).status, 200,
    'the invite stayed usable');
  assert.equal(zoneOf('ana@example.com'), 'Europe/Madrid');

  assert.equal((await accept(admin, (await invite(admin)).token, { email: 'utc@example.com', timezone: 'utc' })).status, 200);
  assert.equal(zoneOf('utc@example.com'), 'UTC');
  assert.equal((await accept(admin, (await invite(admin)).token, { email: 'none@example.com', timezone: undefined })).status, 200);
  assert.equal(zoneOf('none@example.com'), 'UTC', 'no timezone');
});

test('a failure inside the acceptance leaves no account, workspace, membership or used token', async () => {
  const admin = await setup();
  const created = await invite(admin);
  const before = counts(admin);
  // The membership insert is the last write before the token is marked used.
  admin.db.exec(`
    CREATE TEMP TRIGGER fail_membership BEFORE INSERT ON workspace_users
    BEGIN SELECT RAISE(ABORT, 'forced failure'); END
  `);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 500);
  } finally {
    console.error = originalError;
    admin.db.exec('DROP TRIGGER fail_membership');
  }
  assert.deepEqual(counts(admin), before);
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 200, 'the invite stayed usable');
});

test('accepting an invite without the CSRF header is refused before the token lookup', async () => {
  const admin = await setup();
  const first = await invite(admin);
  const second = await invite(admin);
  const before = counts(admin);
  // A cross-site form with enctype="text/plain" can post a JSON body, but it cannot set a CSRF header.
  const textPlain = (token: string, email: string, headers: Record<string, string> = {}) => anonymous(
    admin, 'POST', `/api/app/invites/${token}`, JSON.stringify({ email, password: NEW_PASSWORD }),
    { 'content-type': 'text/plain', ...headers },
  );

  const refused = await textPlain(first.token, 'ana@example.com');
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Missing CSRF header');
  assert.equal(refused.headers.get('set-cookie'), null);
  assert.deepEqual(counts(admin), before);
  // More than the address allowance: if any of these bad tokens were looked up, the address would be blocked.
  for (let i = 0; i <= ADDRESS_LIMIT; i++) assert.equal((await textPlain(`bad-${i}`, 'x@example.com')).status, 403);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${first.token}`)).status, 200, 'the invite is still usable');

  for (const [token, email, header] of [
    [first.token, 'ana@example.com', 'x-tokkl-csrf'], [second.token, 'bea@example.com', 'x-timetrack-csrf'],
  ] as const) {
    const accepted = await textPlain(token, email, { [header]: '1' });
    assert.equal(accepted.status, 200, header);
    assert.match(accepted.headers.get('set-cookie') ?? '', /tokkl_session=/, header);
  }
  assert.equal(counts(admin).users, before.users! + 2);
});

test('a used token cannot be accepted again', async () => {
  const admin = await setup();
  const created = await invite(admin);
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 200);
  const before = counts(admin);
  const again = await accept(admin, created.token, { email: 'other@example.com' });
  assert.equal(again.status, 404);
  assert.equal(await again.json(), INVITE_NOT_FOUND);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${created.token}`)).status, 404);
  assert.deepEqual(counts(admin), before);
});

test('unknown, expired, used and revoked tokens all fail with the same 404', async () => {
  const admin = await setup();
  const expired = await invite(admin);
  admin.db.prepare('UPDATE account_tokens SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), expired.id);
  const revoked = await invite(admin);
  assert.deepEqual((await admin.json('DELETE', `/api/app/admin/invites/${revoked.id}`)).body, { ok: true });
  assert.equal((await admin.json('DELETE', `/api/app/admin/invites/${revoked.id}`)).status, 404, 'already revoked');
  const used = await invite(admin);
  assert.equal((await accept(admin, used.token, { email: 'ana@example.com' })).status, 200);
  assert.equal((await admin.json('DELETE', `/api/app/admin/invites/${used.id}`)).status, 404, 'a used invite cannot be revoked');

  const answers = new Set<string>();
  for (const token of ['unknown-token', expired.token, revoked.token, used.token]) {
    for (const response of [
      await anonymous(admin, 'GET', `/api/app/invites/${token}`),
      await accept(admin, token, { email: `${token.slice(0, 8)}@example.com` }),
    ]) {
      assert.equal(response.status, 404, token);
      answers.add(await response.text());
    }
  }
  assert.deepEqual([...answers], [JSON.stringify(INVITE_NOT_FOUND)]);
  assert.equal((await admin.json('GET', '/api/app/admin/invites')).body.length, 0, 'none is pending');
});

test('a duplicate email or invalid input returns 400 and the invite stays usable', async () => {
  const admin = await setup();
  const created = await invite(admin);
  const before = counts(admin);
  for (const account of [
    { email: 'me@example.com' }, { email: 'ME@example.com' }, { email: 'not-an-email' },
    { email: 'ana@example.com', password: 'short' }, { email: 'ana@example.com', password: 'x'.repeat(1025) },
  ]) {
    const response = await accept(admin, created.token, account);
    assert.equal(response.status, 400, JSON.stringify(account));
  }
  assert.equal(await (await accept(admin, created.token, { email: 'me@example.com' })).json(), 'An account with this email already exists');
  assert.deepEqual(counts(admin), before);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${created.token}`)).status, 200);
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 200);
});

test('repeated bad tokens from one address hit the limiter, which then refuses good tokens too', async () => {
  const admin = await setup();
  const created = await invite(admin);
  for (let i = 0; i < ADDRESS_LIMIT; i++) {
    const path = `/api/app/invites/bad-${i}`;
    const response = i % 2 === 0 ? await anonymous(admin, 'GET', path) : await accept(admin, `bad-${i}`, { email: 'x@example.com' });
    assert.equal(response.status, 404, `attempt ${i + 1}`);
  }
  for (const response of [
    await anonymous(admin, 'GET', '/api/app/invites/bad-again'),
    await anonymous(admin, 'GET', `/api/app/invites/${created.token}`),
    await accept(admin, created.token, { email: 'ana@example.com' }),
  ]) {
    assert.equal(response.status, 429);
    const retryAfter = Number(response.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 900, `Retry-After ${retryAfter}`);
  }
  assert.equal(counts(admin).users, 1, 'the blocked acceptance created nothing');
  // Token guesses share the address counter with passwords, so the login form is blocked too.
  const login = await anonymous(admin, 'POST', '/api/app/login', { email: 'me@example.com', password: 'whatever' }, CSRF);
  assert.equal(login.status, 429);
});
