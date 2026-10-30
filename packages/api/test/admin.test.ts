import { storageFor } from './fixtures/database.ts';
import { sessionCount as countSessions, tokenRows, corruptRecord } from './fixtures/physical.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSRF, PASSWORD, addUser, duringPasswordCheck, sessionCookie, setup, type TestContext } from './helpers.ts';

const basicPassword = (email: string, password = PASSWORD) =>
  `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;

const login = (ctx: TestContext, email: string) =>
  ctx.request('POST', '/api/app/login', { email, password: PASSWORD }, { authorization: '', ...CSRF });

const sessionCount = (ctx: TestContext, userId: number) =>
  countSessions(ctx.db, userId);

test('a regular user gets 403 from every admin route', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  for (const [method, path, body] of [
    ['GET', '/api/app/admin/users', undefined],
    ['PATCH', `/api/app/admin/users/${bob.user.id}`, { role: 'admin' }],
    ['POST', `/api/app/admin/users/${admin.user.id}/sessions/revoke`, undefined],
  ] as const) {
    const response = await bob.json(method, path, body);
    assert.equal(response.status, 403, `${method} ${path}`);
  }
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'user');
});

// The web app shows the admin area from GET /api/v9/me. role and time_resolution_minutes are
// Tokkl-only fields; the Toggl fields keep their names, and the other user-shaped responses stay Toggl-only.
test('GET /api/v9/me carries the instance role and time resolution next to the unchanged Toggl fields', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const TOGGL_FIELDS = [
    '2fa_enabled', 'api_token', 'at', 'authorization_updated_at', 'beginning_of_week', 'country_id', 'created_at',
    'default_workspace_id', 'email', 'fullname', 'has_password', 'id', 'image_url', 'oauth_providers', 'openid_email',
    'openid_enabled', 'timezone', 'toggl_accounts_id', 'updated_at',
  ];

  const adminMe = await admin.json('GET', '/api/v9/me');
  assert.equal(adminMe.status, 200);
  assert.equal(adminMe.body.role, 'admin');
  assert.equal(adminMe.body.time_resolution_minutes, 5);
  assert.deepEqual(Object.keys(adminMe.body).sort(), [...TOGGL_FIELDS, 'role', 'time_resolution_minutes'].sort());
  assert.equal(adminMe.body.email, 'me@example.com');
  assert.equal(adminMe.body.default_workspace_id, admin.wid);

  const bobMe = await bob.json('GET', '/api/v9/me');
  assert.equal(bobMe.body.role, 'user');
  const related = await bob.json('GET', '/api/v9/me?with_related_data=true');
  assert.equal(related.body.role, 'user');

  // A role change shows on the next read.
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { role: 'admin' })).status, 200);
  assert.equal((await bob.json('GET', '/api/v9/me')).body.role, 'admin');

  const updated = await bob.json('PUT', '/api/v9/me', { fullname: 'Bob' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.role, undefined, 'PUT /me answers in the Toggl shape');
  assert.equal(updated.body.time_resolution_minutes, undefined, 'PUT /me answers in the Toggl shape');
});

test('an admin lists every account with only the account fields, ordered by id', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user', fullname: 'Bob' }));
  const seeded = await bob.json('POST', `/api/v9/workspaces/${bob.wid}/time_entries`, {
    start: new Date().toISOString(), duration: 600, description: 'Bob private work', created_with: 'test',
  });
  assert.equal(seeded.status, 200);

  const response = await admin.request('GET', '/api/app/admin/users');
  assert.equal(response.status, 200);
  const text = await response.text();
  const users = JSON.parse(text) as Record<string, unknown>[];
  assert.deepEqual(users.map((user) => user.id), [admin.user.id, bob.user.id]);
  for (const user of users) {
    assert.deepEqual(Object.keys(user).sort(), ['created_at', 'disabled_at', 'email', 'fullname', 'id', 'role']);
  }
  assert.deepEqual(users[1], {
    id: bob.user.id, email: 'bob@example.com', fullname: 'Bob', role: 'user',
    created_at: `${bob.user.createdAt.slice(0, 19)}+00:00`, disabled_at: null,
  });
  assert.ok(!text.includes('Bob private work'), 'no time data');
  for (const secret of [admin.user.apiToken, bob.user.apiToken, admin.user.passwordHash, bob.user.passwordHash]) {
    assert.ok(!text.includes(secret));
  }
});

test('an admin promotes a user and demotes them back', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));

  const promoted = await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { role: 'admin' });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.role, 'admin');
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'admin');
  assert.equal((await bob.json('GET', '/api/app/admin/users')).status, 200);

  const demoted = await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { role: 'user' });
  assert.equal(demoted.status, 200);
  assert.deepEqual(Object.keys(demoted.body).sort(), ['created_at', 'disabled_at', 'email', 'fullname', 'id', 'role']);
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'user');
  assert.equal((await bob.json('GET', '/api/app/admin/users')).status, 403);
});

test('PATCH rejects empty bodies and invalid values with 400 and unknown ids with 404', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const path = `/api/app/admin/users/${bob.user.id}`;
  for (const body of ['', {}, { role: 'owner' }, { role: null }, { disabled: 'yes' }, { role: 'admin', disabled: 1 }]) {
    const response = await admin.json('PATCH', path, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body, 'string');
  }
  assert.equal((await admin.json('PATCH', '/api/app/admin/users/abc', { role: 'admin' })).status, 400);
  assert.equal((await admin.json('PATCH', '/api/app/admin/users/9999', { role: 'admin' })).status, 404);
  assert.equal((await admin.json('POST', '/api/app/admin/users/9999/sessions/revoke')).status, 404);
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'user');
});

test('the last active admin cannot be demoted or disabled, by themselves or anyone', async () => {
  const admin = (await setup());
  const path = `/api/app/admin/users/${admin.user.id}`;
  for (const body of [{ role: 'user' }, { disabled: true }, { role: 'user', disabled: true }]) {
    const response = await admin.json('PATCH', path, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body, 'At least one active admin must remain');
  }

  // A disabled admin does not count, so the remaining active one is still the last.
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'admin' }));
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { disabled: true })).status, 200);
  assert.equal((await admin.json('PATCH', path, { role: 'user' })).status, 400);
  assert.equal((await admin.json('PATCH', path, { disabled: true })).status, 400);

  // With a second active admin, either one can step down.
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { disabled: false })).status, 200);
  assert.equal((await admin.json('PATCH', path, { role: 'user' })).status, 200);
  assert.equal((await carol.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { role: 'user' })).status, 400);
  const users = (await carol.json('GET', '/api/app/admin/users')).body as { role: string; disabled_at: string | null }[];
  assert.equal(users.filter((user) => user.role === 'admin' && user.disabled_at === null).length, 1);
});

test('concurrent demotions of two admins leave one active admin', async () => {
  const admin = (await setup());
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'admin' }));
  const results = await Promise.all([
    admin.json('PATCH', `/api/app/admin/users/${admin.user.id}`, { role: 'user' }),
    carol.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { role: 'user' }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  const active = {n:await storageFor(admin.db).users.countActiveAdmins()};
  assert.equal(active.n, 1);
});

test('a disabled user loses session, API token, Basic password and form login access until re-enabled', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const cookie = (await sessionCookie(bob));
  const otherCookie = (await sessionCookie(bob));
  const adminCookie = (await sessionCookie(admin));
  assert.equal((await sessionCount(admin, bob.user.id)), 2);

  const disabled = await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: true });
  assert.equal(disabled.status, 200);
  assert.match(disabled.body.disabled_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  assert.equal((await sessionCount(admin, bob.user.id)), 0);

  const attempts: Record<string, string>[] = [
    { authorization: '', cookie }, { authorization: '', cookie: otherCookie }, {}, { authorization: basicPassword('bob@example.com') },
  ];
  for (const headers of attempts) {
    const response = await bob.request('GET', '/api/v9/me', undefined, headers);
    assert.equal(response.status, 403);
    assert.equal(await response.json(), 'Incorrect username and/or password');
  }
  const refused = (await login(bob, 'bob@example.com'));
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Incorrect email or password');
  assert.equal(refused.headers.get('set-cookie'), null);
  // The admin's own session is untouched.
  assert.equal((await admin.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: adminCookie })).status, 200);

  const enabled = await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: false });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.disabled_at, null);
  assert.equal((await login(bob, 'bob@example.com')).status, 200);
  assert.equal((await bob.json('GET', '/api/v9/me')).status, 200);
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: basicPassword('bob@example.com') })).status, 200);
  // Sessions deleted by the disable stay gone.
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: '', cookie })).status, 403);
});

test('a disabled account with the right password is charged as a failed attempt', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: true })).status, 200);
  // Ten failures for one account from one address fill its tightest counter.
  for (let i = 0; i < 10; i++) assert.equal((await login(bob, 'bob@example.com')).status, 403);
  assert.equal((await login(bob, 'bob@example.com')).status, 429);
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: basicPassword('bob@example.com') })).status, 429);
});

test('revoking sessions signs out only that user and keeps their API token', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'user' }));
  const bobCookies = [(await sessionCookie(bob)), (await sessionCookie(bob))];
  const carolCookie = (await sessionCookie(carol));
  const adminCookie = (await sessionCookie(admin));

  const revoked = await admin.json('POST', `/api/app/admin/users/${bob.user.id}/sessions/revoke`);
  assert.equal(revoked.status, 200);
  assert.equal((await sessionCount(admin, bob.user.id)), 0);
  for (const cookie of bobCookies) {
    assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: '', cookie })).status, 403);
  }
  assert.equal((await bob.json('GET', '/api/v9/me')).status, 200);
  assert.equal((await carol.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: carolCookie })).status, 200);
  assert.equal((await admin.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: adminCookie })).status, 200);
  assert.equal((await login(bob, 'bob@example.com')).status, 200);
});

test('cookie-authenticated admin writes need the CSRF header; Basic auth does not', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const cookie = (await sessionCookie(admin));
  const bobCookie = (await sessionCookie(bob));
  const patch = `/api/app/admin/users/${bob.user.id}`;
  const revoke = `/api/app/admin/users/${bob.user.id}/sessions/revoke`;
  const asCookie = { authorization: '', cookie };

  assert.equal((await admin.request('GET', '/api/app/admin/users', undefined, asCookie)).status, 200);
  const noCsrfPatch = await admin.request('PATCH', patch, { role: 'admin' }, asCookie);
  assert.equal(noCsrfPatch.status, 403);
  assert.equal(await noCsrfPatch.json(), 'Missing CSRF header');
  assert.equal((await admin.request('POST', revoke, undefined, asCookie)).status, 403);
  assert.equal((await sessionCount(admin, bob.user.id)), 1);
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'user');

  assert.equal((await admin.request('PATCH', patch, { role: 'admin' }, { ...asCookie, 'x-tokkl-csrf': '1' })).status, 200);
  assert.equal((await admin.request('PATCH', patch, { role: 'user' }, { authorization: basicPassword('me@example.com') })).status, 200);
  assert.equal((await admin.request('POST', revoke)).status, 200);
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: '', cookie: bobCookie })).status, 403);
});

test('a disabled admin gets 403 from every admin route', async () => {
  const admin = (await setup());
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'admin' }));
  const carolCookie = (await sessionCookie(carol));
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { disabled: true })).status, 200);

  const credentials: Record<string, string>[] = [
    {}, { authorization: basicPassword('carol@example.com') }, { authorization: '', cookie: carolCookie, 'x-tokkl-csrf': '1' },
  ];
  for (const headers of credentials) {
    for (const [method, path, body] of [
      ['GET', '/api/app/admin/users', undefined],
      ['PATCH', `/api/app/admin/users/${admin.user.id}`, { role: 'user' }],
      ['POST', `/api/app/admin/users/${admin.user.id}/sessions/revoke`, undefined],
    ] as const) {
      const response = await carol.request(method, path, body, headers);
      assert.equal(response.status, 403, `${method} ${path} ${JSON.stringify(headers)}`);
    }
  }
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[0].role, 'admin');
});

test('an admin demoted during their Basic password check is refused and stays demoted', async (t) => {
  const admin = (await setup());
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'admin' }));
  duringPasswordCheck(t, async () => {
    assert.equal((await admin.json('PATCH', `/api/app/admin/users/${carol.user.id}`, { role: 'user' })).status, 200);
  });

  const response = await carol.request('PATCH', `/api/app/admin/users/${carol.user.id}`, { role: 'admin' }, {
    authorization: basicPassword('carol@example.com'),
  });
  assert.equal(response.status, 403);
  assert.equal(await response.json(), 'Admin access required');
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body[1].role, 'user');
});

test('an account disabled during its Basic password check is refused', async (t) => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  duringPasswordCheck(t, async () => {
    assert.equal((await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: true })).status, 200);
  });

  const response = await bob.request('GET', '/api/v9/me', undefined, { authorization: basicPassword('bob@example.com') });
  assert.equal(response.status, 403);
  assert.equal(await response.json(), 'Incorrect username and/or password');
});

test('a form login whose account is disabled during the password check creates no session', async (t) => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  duringPasswordCheck(t, async () => {
    assert.equal((await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: true })).status, 200);
  });

  const response = (await login(bob, 'bob@example.com'));
  assert.equal(response.status, 403);
  assert.equal(await response.json(), 'Incorrect email or password');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await sessionCount(admin, bob.user.id)), 0);
});
