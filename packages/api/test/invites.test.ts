import { memberships } from './fixtures/observations.ts';
import { tokenRows, corruptRecord, failMembershipInsert } from './fixtures/physical.ts';
import { servicesFor, storageFor } from './fixtures/database.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_LIMIT } from '../src/auth/rateLimit.ts';
import { INVITE_NOT_FOUND } from '../src/domain/accountLinks.ts';
import { createSessionAccountOperations } from '../src/services/application.ts';
import { addUser, anonymous, CSRF, setup, type TestContext } from './helpers.ts';

const DAY_MS = 86_400_000;
const NEW_PASSWORD = 'invited person 1';

async function invite(admin: TestContext, body: Record<string, unknown> = { role: 'user' }) {
  const response = await admin.request('POST', '/api/app/admin/invites', body);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const created = JSON.parse(text) as { id: number; url: string; expires_at: string; created_at: string };
  return { ...created, token: created.url.replace(/^\/invite\//, ''), text };
}

const accept = (ctx: TestContext, token: string, account: Record<string, unknown>) =>
  anonymous(
    ctx,
    'POST',
    `/api/app/invites/${token}`,
    { password: NEW_PASSWORD, timezone: 'Europe/Madrid', ...account },
    CSRF,
  );

const counts = async (ctx: TestContext) => {
  const users = await storageFor(ctx.db).users.list();
  const workspaces = new Set(
    (await Promise.all(users.map(user => storageFor(ctx.db).workspaces.listForUser(user.id))))
      .flat()
      .map(row => row.id),
  );
  return {
    users: users.length,
    workspaces: workspaces.size,
    memberships: (await memberships(ctx.db)).length,
    used: (await tokenRows(ctx.db)).filter(row => row.used_at !== null).length,
  };
};

test('an admin creates an invite, sees its URL once, and lists it without the token', async () => {
  const admin = await setup();
  const created = await invite(admin, { role: 'admin', note: '  For Ana  ' });
  assert.match(created.url, /^\/invite\/[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.equal(new Set([created.token, (await invite(admin)).token]).size, 2);

  const stored = (await tokenRows(admin.db)).find(row => row.id === created.id)!;
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
  assert.deepEqual(Object.keys(listed[0]!).sort(), [
    'created_at',
    'created_by',
    'email',
    'expires_at',
    'id',
    'note',
    'role',
    'source',
  ]);
  assert.deepEqual(
    { ...listed[0], created_at: undefined, expires_at: undefined },
    {
      id: created.id,
      role: 'admin',
      note: 'For Ana',
      email: null,
      source: 'admin',
      created_by: admin.user.id,
      created_at: undefined,
      expires_at: undefined,
    },
  );

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
  const row = (await tokenRows(admin.db)).find(row => row.id === created.id)!;
  assert.equal(Date.parse(row.expires_at!) - Date.parse(row.created_at!), 3 * DAY_MS);
});

test('signup requests replace the normalized email link and can undo an unsent invite', async () => {
  const admin = await setup();
  const operations = servicesFor(admin.db).signupInvites;
  const adminInvite = await invite(admin);
  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { invite_days: 3 })).status, 200);

  const first = await operations.createSignupInvite('  New.Person@Example.com  ');
  assert.equal(first.existing, false);
  assert.ok(!first.existing);
  assert.equal(first.invite.email, 'new.person@example.com');
  assert.equal(first.invite.role, 'user');
  assert.equal(first.invite.note, null);
  assert.equal(first.invite.createdBy, null);
  assert.equal(first.invite.userId, null);
  assert.equal(first.invite.usedAt, null);
  assert.equal(Date.parse(first.invite.expiresAt) - Date.parse(first.invite.createdAt), 3 * DAY_MS);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = (await tokenRows(admin.db)).find(row => row.id === first.invite.id)!;
  assert.notEqual(stored.token_hash, first.token);
  assert.ok(!JSON.stringify(await tokenRows(admin.db)).includes(first.token), 'only the hash is stored');

  const other = await operations.createSignupInvite('other@example.com');
  assert.ok(!other.existing);
  const second = await operations.createSignupInvite('NEW.PERSON@example.COM');
  assert.ok(!second.existing);
  assert.notEqual(second.token, first.token);
  for (const response of [
    await anonymous(admin, 'GET', `/api/app/invites/${first.token}`),
    await accept(admin, first.token, { email: 'new.person@example.com' }),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(await response.json(), INVITE_NOT_FOUND);
  }
  for (const token of [second.token, other.token, adminInvite.token])
    assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${token}`)).status, 200);

  assert.equal((await accept(admin, second.token, {})).status, 200, 'the replacement link can be accepted');
  assert.ok(await storageFor(admin.db).users.findByEmail('new.person@example.com'));
  await operations.deleteSignupInvite(second.invite.id);
  assert.ok(
    (await tokenRows(admin.db)).some(row => row.id === second.invite.id),
    'used links are kept',
  );

  const unsent = await operations.createSignupInvite('unsent@example.com');
  assert.ok(!unsent.existing);
  await operations.deleteSignupInvite(unsent.invite.id);
  await operations.deleteSignupInvite(unsent.invite.id);
  const removed = await anonymous(admin, 'GET', `/api/app/invites/${unsent.token}`);
  assert.equal(removed.status, 404);
  assert.equal(await removed.json(), INVITE_NOT_FOUND);
  assert.ok(!(await tokenRows(admin.db)).some(row => row.id === unsent.invite.id), 'the unsent row is deleted');
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${other.token}`)).status, 200);
});

test('signup requests for active and disabled accounts create no invite', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const before = await tokenRows(admin.db);
  const operations = servicesFor(admin.db).signupInvites;
  for (const email of [' ME@EXAMPLE.COM ', 'BOB@example.com'])
    assert.deepEqual(await operations.createSignupInvite(email), { existing: true });
  assert.equal((await admin.json('PATCH', `/api/app/admin/users/${bob.user.id}`, { disabled: true })).status, 200);
  assert.deepEqual(await operations.createSignupInvite(' Bob@example.com '), { existing: true });
  assert.deepEqual(await tokenRows(admin.db), before);
});

test('signup invite acceptance ignores different, absent and invalid body emails', async () => {
  const admin = await setup();
  const operations = servicesFor(admin.db).signupInvites;
  const attackerEmails = ['me@example.com', undefined, 'not-an-email', null, { email: 'attacker@example.com' }];
  for (const [index, email] of attackerEmails.entries()) {
    const lockedEmail = `locked-${index}@example.com`;
    const created = await operations.createSignupInvite(lockedEmail);
    assert.ok(!created.existing);
    const response = await accept(admin, created.token, { email, role: 'admin', fullname: 'New Person' });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { ok: true });
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const me = await anonymous(admin, 'GET', '/api/v9/me', undefined, { cookie });
    assert.equal(me.status, 200);
    const account = (await me.json()) as { email: string; role: string };
    assert.equal(account.email, lockedEmail);
    assert.equal(account.role, 'user');
    const user = (await storageFor(admin.db).users.findByEmail(lockedEmail))!;
    assert.equal((await storageFor(admin.db).workspaces.get(user.defaultWorkspaceId))!.name, 'New Person workspace');
    assert.deepEqual(
      (await memberships(admin.db)).filter(row => row.user_id === user.id).map(row => row.role),
      ['owner'],
    );
    for (const reused of [
      await anonymous(admin, 'GET', `/api/app/invites/${created.token}`),
      await accept(admin, created.token, {}),
    ]) {
      assert.equal(reused.status, 404);
      assert.equal(await reused.json(), INVITE_NOT_FOUND);
    }
  }
});

test('domain acceptance uses the signup email even when the caller supplies another account email', async () => {
  const admin = await setup();
  const services = servicesFor(admin.db);
  const created = await services.signupInvites.createSignupInvite('domain@example.com');
  assert.ok(!created.existing);
  const user = await createSessionAccountOperations(storageFor(admin.db), services).acceptInvite(created.token, {
    email: 'me@example.com',
    fullname: 'Domain',
    timezone: 'UTC',
    password: NEW_PASSWORD,
  });
  assert.equal(user.email, 'domain@example.com');
  assert.equal(user.role, 'user');
});

test('signup invites retain validation and detect an account created after the invite', async () => {
  const admin = await setup();
  const created = await servicesFor(admin.db).signupInvites.createSignupInvite('later@example.com');
  assert.ok(!created.existing);
  const before = await counts(admin);
  for (const body of [{ password: 'short' }, { password: 'x'.repeat(1025) }, { timezone: '+02:00' }]) {
    const response = await accept(admin, created.token, { email: 'attacker@example.com', ...body });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(await counts(admin), before);
  await addUser(admin, { email: 'LATER@example.com', role: 'user' });
  const after = await counts(admin);
  const duplicate = await accept(admin, created.token, { email: 'attacker@example.com' });
  assert.equal(duplicate.status, 400);
  assert.equal(await duplicate.json(), 'An account with this email already exists');
  assert.equal(duplicate.headers.get('set-cookie'), null);
  assert.deepEqual(await counts(admin), after);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${created.token}`)).status, 200);
});

test('signup invite info and the admin list show the locked email and admins can revoke the link', async () => {
  const admin = await setup();
  const created = await servicesFor(admin.db).signupInvites.createSignupInvite('listed@example.com');
  assert.ok(!created.existing);
  const info = await anonymous(admin, 'GET', `/api/app/invites/${created.token}`);
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { role: 'user', email: 'listed@example.com' });
  const list = await admin.json('GET', '/api/app/admin/invites');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, [
    {
      id: created.invite.id,
      role: 'user',
      note: null,
      email: 'listed@example.com',
      source: 'signup',
      created_by: null,
      created_at: created.invite.createdAt.replace(/\.\d{3}Z$/, '+00:00'),
      expires_at: created.invite.expiresAt.replace(/\.\d{3}Z$/, '+00:00'),
    },
  ]);
  assert.ok(!JSON.stringify(list.body).includes(created.token));
  assert.ok(!JSON.stringify(list.body).includes(created.invite.tokenHash));
  assert.equal((await admin.json('DELETE', `/api/app/admin/invites/${created.invite.id}`)).status, 200);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/invites')).body, []);
  for (const response of [
    await anonymous(admin, 'GET', `/api/app/invites/${created.token}`),
    await accept(admin, created.token, {}),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(await response.json(), INVITE_NOT_FOUND);
  }
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

  const user = (await storageFor(admin.db).users.findByEmail('ana@example.com'))!;
  assert.equal(user.role, 'admin', 'the invite role');
  assert.equal(user.fullName, 'Ana');
  assert.equal(user.timezone, 'Europe/Madrid');
  const workspace = (await storageFor(admin.db).workspaces.get(user.defaultWorkspaceId))!;
  assert.equal(workspace.name, 'Ana workspace');
  assert.deepEqual(
    (await memberships(admin.db))
      .filter(row => row.user_id === user.id)
      .map(({ workspace_id, role }) => ({ workspace_id, role })),
    [{ workspace_id: workspace.id, role: 'owner' }],
  );
  const token = (await tokenRows(admin.db)).find(row => row.id === created.id)!;
  assert.ok(token.used_at);
  assert.equal(token.user_id, user.id);

  const me = await anonymous(admin, 'GET', '/api/v9/me', undefined, { cookie: session });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { email: string }).email, 'ana@example.com');

  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };
  for (const path of [
    '/api/app/report',
    '/api/app/report/weekly',
    '/api/app/report/entries',
    '/api/app/report/detailed.csv',
    '/api/app/report/summary.csv',
  ]) {
    const report = await anonymous(admin, 'POST', path, range, { cookie: session, 'x-tokkl-csrf': '1' });
    assert.equal(report.status, 200, path);
  }
  assert.equal(
    (await admin.json('GET', '/api/app/admin/invites')).body.length,
    0,
    'a used invite is no longer pending',
  );

  const unnamed = await invite(admin);
  assert.equal((await accept(admin, unnamed.token, { email: 'nameless@example.com' })).status, 200);
  const nameless = (await storageFor(admin.db).users.findByEmail('nameless@example.com'))!;
  assert.equal(nameless.role, 'user');
  assert.equal((await storageFor(admin.db).workspaces.get(nameless.defaultWorkspaceId))!.name, 'My workspace');
});

test('accepting an invite stores the canonical timezone, refuses invalid and offset ones, and defaults to UTC', async () => {
  const admin = await setup();
  const zoneOf = async (email: string) => (await storageFor(admin.db).users.findByEmail(email))!.timezone;

  const created = await invite(admin);
  const before = await counts(admin);
  for (const timezone of ['+02:00', '-0500', 'Bogus/Zone']) {
    const refused = await accept(admin, created.token, { email: 'ana@example.com', timezone });
    assert.equal(refused.status, 400, timezone);
    assert.equal(await refused.json(), 'Invalid timezone', timezone);
    assert.equal(refused.headers.get('set-cookie'), null, timezone);
  }
  assert.deepEqual(await counts(admin), before, 'no account was created');
  assert.equal(
    (await accept(admin, created.token, { email: 'ana@example.com', timezone: 'europe/madrid' })).status,
    200,
    'the invite stayed usable',
  );
  assert.equal(await zoneOf('ana@example.com'), 'Europe/Madrid');

  assert.equal(
    (await accept(admin, (await invite(admin)).token, { email: 'utc@example.com', timezone: 'utc' })).status,
    200,
  );
  assert.equal(await zoneOf('utc@example.com'), 'UTC');
  assert.equal(
    (await accept(admin, (await invite(admin)).token, { email: 'none@example.com', timezone: undefined })).status,
    200,
  );
  assert.equal(await zoneOf('none@example.com'), 'UTC', 'no timezone');
});

test('a failure inside the acceptance leaves no account, workspace, membership or used token', async () => {
  const admin = await setup();
  const created = await invite(admin);
  const before = await counts(admin);
  // The membership insert is the last write before the token is marked used.
  const restoreMembership = await failMembershipInsert(admin.db);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 500);
  } finally {
    console.error = originalError;
    await restoreMembership();
  }
  assert.deepEqual(await counts(admin), before);
  assert.equal(
    (await accept(admin, created.token, { email: 'ana@example.com' })).status,
    200,
    'the invite stayed usable',
  );
});

test('accepting an invite without the CSRF header is refused before the token lookup', async () => {
  const admin = await setup();
  const first = await invite(admin);
  const second = await invite(admin);
  const before = await counts(admin);
  // A cross-site form with enctype="text/plain" can post a JSON body, but it cannot set a CSRF header.
  const textPlain = (token: string, email: string, headers: Record<string, string> = {}) =>
    anonymous(admin, 'POST', `/api/app/invites/${token}`, JSON.stringify({ email, password: NEW_PASSWORD }), {
      'content-type': 'text/plain',
      ...headers,
    });

  const refused = await textPlain(first.token, 'ana@example.com');
  assert.equal(refused.status, 403);
  assert.equal(await refused.json(), 'Missing CSRF header');
  assert.equal(refused.headers.get('set-cookie'), null);
  assert.deepEqual(await counts(admin), before);
  // More than the address allowance: if any of these bad tokens were looked up, the address would be blocked.
  for (let i = 0; i <= ADDRESS_LIMIT; i++) assert.equal((await textPlain(`bad-${i}`, 'x@example.com')).status, 403);
  assert.equal(
    (await anonymous(admin, 'GET', `/api/app/invites/${first.token}`)).status,
    200,
    'the invite is still usable',
  );

  for (const [token, email, header] of [
    [first.token, 'ana@example.com', 'x-tokkl-csrf'],
    [second.token, 'bea@example.com', 'x-timetrack-csrf'],
  ] as const) {
    const accepted = await textPlain(token, email, { [header]: '1' });
    assert.equal(accepted.status, 200, header);
    assert.match(accepted.headers.get('set-cookie') ?? '', /tokkl_session=/, header);
  }
  assert.equal((await counts(admin)).users, before.users! + 2);
});

test('a used token cannot be accepted again', async () => {
  const admin = await setup();
  const created = await invite(admin);
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 200);
  const before = await counts(admin);
  const again = await accept(admin, created.token, { email: 'other@example.com' });
  assert.equal(again.status, 404);
  assert.equal(await again.json(), INVITE_NOT_FOUND);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${created.token}`)).status, 404);
  assert.deepEqual(await counts(admin), before);
});

test('unknown, expired, used and revoked tokens all fail with the same 404', async () => {
  const admin = await setup();
  const expired = await invite(admin);
  await corruptRecord(
    admin.db,
    'account_tokens',
    { expires_at: new Date(Date.now() - 1000).toISOString() },
    { id: expired.id },
  );
  const revoked = await invite(admin);
  assert.deepEqual((await admin.json('DELETE', `/api/app/admin/invites/${revoked.id}`)).body, { ok: true });
  assert.equal((await admin.json('DELETE', `/api/app/admin/invites/${revoked.id}`)).status, 404, 'already revoked');
  const used = await invite(admin);
  assert.equal((await accept(admin, used.token, { email: 'ana@example.com' })).status, 200);
  assert.equal(
    (await admin.json('DELETE', `/api/app/admin/invites/${used.id}`)).status,
    404,
    'a used invite cannot be revoked',
  );

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
  const before = await counts(admin);
  for (const account of [
    { email: 'me@example.com' },
    { email: 'ME@example.com' },
    { email: 'not-an-email' },
    { email: 'ana@example.com', password: 'short' },
    { email: 'ana@example.com', password: 'x'.repeat(1025) },
  ]) {
    const response = await accept(admin, created.token, account);
    assert.equal(response.status, 400, JSON.stringify(account));
  }
  assert.equal(
    await (await accept(admin, created.token, { email: 'me@example.com' })).json(),
    'An account with this email already exists',
  );
  assert.deepEqual(await counts(admin), before);
  assert.equal((await anonymous(admin, 'GET', `/api/app/invites/${created.token}`)).status, 200);
  assert.equal((await accept(admin, created.token, { email: 'ana@example.com' })).status, 200);
});

test('repeated bad tokens from one address hit the limiter, which then refuses good tokens too', async () => {
  const admin = await setup();
  const created = await invite(admin);
  for (let i = 0; i < ADDRESS_LIMIT; i++) {
    const path = `/api/app/invites/bad-${i}`;
    const response =
      i % 2 === 0 ? await anonymous(admin, 'GET', path) : await accept(admin, `bad-${i}`, { email: 'x@example.com' });
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
  assert.equal((await counts(admin)).users, 1, 'the blocked acceptance created nothing');
  // Token guesses share the address counter with passwords, so the login form is blocked too.
  const login = await anonymous(
    admin,
    'POST',
    '/api/app/login',
    { email: 'me@example.com', password: 'whatever' },
    CSRF,
  );
  assert.equal(login.status, 429);
});
