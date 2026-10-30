import { test, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_ADDRESS_LIMIT, ADDRESS_LIMIT } from '../src/auth/rateLimit.ts';
import { RESET_NOT_FOUND } from '../src/domain/accounts.ts';
import { addUser, CSRF, duringPasswordCheck, PASSWORD, sessionCookie, setup, type TestContext } from './helpers.ts';

const HOUR_MS = 3_600_000;
const NEW_PASSWORD = 'brand new secret';

async function issue(admin: TestContext, userId: number) {
  const response = await admin.request('POST', `/api/app/admin/users/${userId}/password-reset`);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const created = JSON.parse(text) as { url: string; expires_at: string };
  return { ...created, token: created.url.replace(/^\/reset\//, ''), text };
}

/** A request without the admin's API token, as a logged-out browser sends it. */
const anonymous = (ctx: TestContext, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  ctx.request(method, path, body, { authorization: '', ...headers });

const check = (ctx: TestContext, token: string) => anonymous(ctx, 'GET', `/api/app/password-resets/${token}`);

const use = (ctx: TestContext, token: string, password: unknown = NEW_PASSWORD) =>
  anonymous(ctx, 'POST', `/api/app/password-resets/${token}`, { password }, CSRF);

const login = (ctx: TestContext, email: string, password: string) =>
  anonymous(ctx, 'POST', '/api/app/login', { email, password }, CSRF);

const meWith = (ctx: TestContext, cookie: string) => anonymous(ctx, 'GET', '/api/v9/me', undefined, { cookie });

const resetRows = (ctx: TestContext) => ctx.db.prepare("SELECT * FROM account_tokens WHERE kind = 'password_reset' ORDER BY id")
  .all() as Array<Record<string, unknown>>;

test('an admin receives a 24-hour reset link once, and only its hash is stored', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const created = (await issue(admin, bob.user.id));
  assert.match(created.url, /^\/reset\/[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.deepEqual(Object.keys(JSON.parse(created.text)).sort(), ['expires_at', 'url']);

  const [row] = resetRows(admin);
  assert.notEqual(row!.token_hash, created.token, 'only the hash is stored');
  assert.equal(row!.user_id, bob.user.id);
  assert.equal(row!.created_by, admin.user.id);
  assert.equal(row!.role, null);
  assert.equal(Date.parse(String(row!.expires_at)) - Date.parse(String(row!.created_at)), 24 * HOUR_MS);

  for (const path of ['/api/app/admin/users', '/api/app/admin/invites']) {
    const text = await (await admin.request('GET', path)).text();
    assert.ok(!text.includes(created.token), `${path} never carries the token`);
    assert.ok(!text.includes(String(row!.token_hash)), `nor its hash: ${path}`);
  }
  const checked = await check(admin, created.token);
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), { email: 'bob@example.com' });
  const used = await use(admin, created.token);
  assert.equal(used.status, 200);
  assert.ok(!(await used.text()).includes(created.token), 'using the link does not echo it');

  assert.equal((await admin.request('POST', '/api/app/admin/users/9999/password-reset')).status, 404, 'unknown user');
});

test('using a link sets the password, ends every session of the account and starts none', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const sessions = [(await sessionCookie(bob)), (await sessionCookie(bob))];
  const adminSession = (await sessionCookie(admin));
  for (const cookie of sessions) assert.equal((await meWith(admin, cookie)).status, 200);
  const created = (await issue(admin, bob.user.id));

  const response = await use(admin, created.token);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('set-cookie'), null, 'no session is started');

  for (const cookie of sessions) assert.equal((await meWith(admin, cookie)).status, 403, 'old sessions end');
  assert.equal((await meWith(admin, adminSession)).status, 200, "other accounts' sessions stay");
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 403, 'the old password stops working');
  assert.equal((await login(admin, 'bob@example.com', NEW_PASSWORD)).status, 200);
  assert.ok(resetRows(admin)[0]!.used_at, 'the link is marked used');
});

test('using a link replaces the API token, and GET /me hands out the new one after logging in', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const saved = bob.user.apiToken;
  assert.equal((await bob.request('GET', '/api/v9/me')).status, 200);
  const created = (await issue(admin, bob.user.id));

  const response = await use(admin, created.token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('set-cookie'), null, 'no session is started');

  assert.equal((await bob.request('GET', '/api/v9/me')).status, 403, 'the saved token stops working');
  assert.equal((await admin.request('GET', '/api/v9/me')).status, 200, "other accounts' tokens stay");

  const loggedIn = (await login(admin, 'bob@example.com', NEW_PASSWORD));
  assert.equal(loggedIn.status, 200);
  const me = await meWith(admin, loggedIn.headers.get('set-cookie')!.split(';')[0]!);
  assert.equal(me.status, 200);
  const replacement = ((await me.json()) as { api_token: string }).api_token;
  assert.notEqual(replacement, saved);
  const withReplacement = await anonymous(admin, 'GET', '/api/v9/me', undefined, {
    authorization: `Basic ${Buffer.from(`${replacement}:api_token`).toString('base64')}`,
  });
  assert.equal(withReplacement.status, 200, 'the replacement token signs in');
});

test('a reset without the CSRF header is refused before the lookup and the limiter', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const created = (await issue(admin, bob.user.id));
  // A cross-site form with enctype="text/plain" can post a JSON body, but it cannot set a CSRF header.
  const textPlain = (token: string, headers: Record<string, string> = {}) => anonymous(
    admin, 'POST', `/api/app/password-resets/${token}`, JSON.stringify({ password: NEW_PASSWORD }),
    { 'content-type': 'text/plain', ...headers },
  );
  const refused = await textPlain(created.token);
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Missing CSRF header');
  // More than the address allowance: if any of these bad tokens were looked up, the address would be blocked.
  for (let i = 0; i <= ADDRESS_LIMIT; i++) assert.equal((await textPlain(`bad-${i}`)).status, 403);
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 200, 'the password is unchanged');
  assert.equal((await textPlain(created.token, { 'x-tokkl-csrf': '1' })).status, 200, 'the link stayed usable');
});

test('a password outside the length rules is a 400 and leaves the link usable', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const created = (await issue(admin, bob.user.id));
  for (const [password, message] of [
    ['short', 'Password must be at least 8 characters'],
    [null, 'Password must be at least 8 characters'],
    [12345678, 'Password must be at least 8 characters'],
    ['x'.repeat(1025), 'Password must be at most 1024 characters'],
  ] as const) {
    const response = await use(admin, created.token, password);
    assert.equal(response.status, 400, String(password).slice(0, 10));
    assert.equal(await response.json(), message);
  }
  assert.equal(resetRows(admin)[0]!.used_at, null);
  assert.equal((await use(admin, created.token)).status, 200);
});

test('used, expired, replaced, unknown and disabled-account links all fail with the same 404', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const cy = (await addUser(admin, { email: 'cy@example.com', role: 'user' }));
  const dee = (await addUser(admin, { email: 'dee@example.com', role: 'user' }));

  const used = (await issue(admin, bob.user.id));
  assert.equal((await use(admin, used.token)).status, 200);

  const replaced = (await issue(admin, cy.user.id));
  const current = (await issue(admin, cy.user.id));
  assert.equal(resetRows(admin).filter((row) => row.user_id === cy.user.id).length, 1, 'the earlier unused link is deleted');

  const expired = (await issue(admin, dee.user.id));
  // A link issued 24 hours and a second ago.
  admin.db.prepare('UPDATE account_tokens SET created_at = ?, expires_at = ? WHERE user_id = ?')
    .run(new Date(Date.now() - 24 * HOUR_MS - 1000).toISOString(), new Date(Date.now() - 1000).toISOString(), dee.user.id);

  const eve = (await addUser(admin, { email: 'eve@example.com', role: 'user' }));
  const disabled = (await issue(admin, eve.user.id));
  assert.equal((await check(admin, disabled.token)).status, 200);
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${eve.user.id}`, { disabled: true })).status, 200);

  const answers = new Set<string>();
  for (const token of ['unknown-token', used.token, replaced.token, expired.token, disabled.token]) {
    for (const response of [await check(admin, token), await use(admin, token, 'another password')]) {
      assert.equal(response.status, 404, token);
      answers.add(await response.text());
    }
  }
  assert.deepEqual([...answers], [JSON.stringify(RESET_NOT_FOUND)]);
  for (const [email, password] of [['bob@example.com', NEW_PASSWORD], ['cy@example.com', PASSWORD], ['dee@example.com', PASSWORD]]) {
    assert.equal((await login(admin, email!, password!)).status, 200, `${email} keeps its password`);
  }
  assert.equal((await use(admin, current.token)).status, 200, 'the newest link works');

  // An admin cannot issue a link for a disabled account; enabling it comes first.
  const refused = await admin.request('POST', `/api/app/admin/users/${eve.user.id}/password-reset`);
  assert.equal(refused.status, 400);
  assert.equal(await refused.json(), 'Enable the account before resetting its password');
});

test('a regular user gets 403 when issuing a link', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  for (const id of [admin.user.id, bob.user.id]) {
    assert.equal((await bob.request('POST', `/api/app/admin/users/${id}/password-reset`)).status, 403);
  }
  assert.equal(resetRows(admin).length, 0);
});

test('repeated bad tokens from one address hit the limiter, which then refuses good links too', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const created = (await issue(admin, bob.user.id));
  for (let i = 0; i < ADDRESS_LIMIT; i++) {
    const response = i % 2 === 0 ? await check(admin, `bad-${i}`) : await use(admin, `bad-${i}`);
    assert.equal(response.status, 404, `attempt ${i + 1}`);
  }
  for (const response of [await check(admin, 'bad-again'), await check(admin, created.token), await use(admin, created.token)]) {
    assert.equal(response.status, 429);
    const retryAfter = Number(response.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 900, `Retry-After ${retryAfter}`);
  }
  assert.equal(resetRows(admin)[0]!.used_at, null, 'the blocked request used nothing');
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 429, 'token guesses share the address counter');
});

test('a reset clears earlier failed logins against the account from that address', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  for (let i = 0; i < ACCOUNT_ADDRESS_LIMIT; i++) {
    assert.equal((await login(admin, 'bob@example.com', `wrong guess ${i}`)).status, 403);
  }
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 429);
  const created = (await issue(admin, bob.user.id));
  assert.equal((await use(admin, created.token)).status, 200);
  assert.equal((await login(admin, 'bob@example.com', NEW_PASSWORD)).status, 200);
});

/**
 * The two ways a password changes while someone else's check against the old one is running: an
 * admin's reset link used, and the owner's own change through PUT /me (signed in by API token, so it
 * runs no check of its own before the mocked one).
 */
const passwordChanges: Array<[string, (admin: TestContext, bob: TestContext) => Promise<void>]> = [
  ['a password reset', async (admin, bob) => {
    const created = (await issue(admin, bob.user.id));
    assert.equal((await use(admin, created.token)).status, 200);
  }],
  ['a PUT /me password change', async (_admin, bob) => {
    const changed = await bob.request('PUT', '/api/v9/me', { current_password: PASSWORD, password: NEW_PASSWORD });
    assert.equal(changed.status, 200);
  }],
];

async function changedDuringCheck(t: NodeTestContext, change: (typeof passwordChanges)[number][1]) {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  duringPasswordCheck(t, () => change(admin, bob));
  return { admin, bob };
}

const sessionCount = (ctx: TestContext, userId: number) =>
  (ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId) as { n: number }).n;

for (const [name, change] of passwordChanges) {
  test(`a form login checked against the old password while ${name} commits gets 403 and no session`, async (t) => {
    const { admin, bob } = (await changedDuringCheck(t, change));
    const response = (await login(admin, 'bob@example.com', PASSWORD));
    assert.equal(response.status, 403);
    assert.equal(await response.json(), 'Incorrect email or password');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(sessionCount(admin, bob.user.id), 0);
    assert.equal((await login(admin, 'bob@example.com', NEW_PASSWORD)).status, 200, 'the new password works');
  });

  test(`a Basic request checked against the old password while ${name} commits gets 403`, async (t) => {
    const { admin } = (await changedDuringCheck(t, change));
    const basic = (password: string) => anonymous(admin, 'GET', '/api/v9/me', undefined, {
      authorization: `Basic ${Buffer.from(`bob@example.com:${password}`).toString('base64')}`,
    });
    const response = await basic(PASSWORD);
    assert.equal(response.status, 403);
    assert.equal(await response.json(), 'Incorrect username and/or password');
    assert.equal((await basic(NEW_PASSWORD)).status, 200, 'the new password works');
  });
}
