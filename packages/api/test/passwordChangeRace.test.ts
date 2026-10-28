import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import type { TestContext } from './helpers.ts';

/*
 * PUT /me with a password awaits scrypt twice: once to check current_password and once to hash the
 * new one. These tests hold one of those scrypt results until another request has committed, so the
 * ordering is fixed without timers. src/auth/crypto.ts binds scrypt when it loads, so the wrapper is
 * installed before anything from src is imported, and the app modules are imported afterwards.
 */
type ScryptCallback = (error: Error | null, key: Buffer) => void;
const realScrypt = crypto.scrypt as unknown as (...args: unknown[]) => void;
let held: { remaining: number; during: () => Promise<unknown>; settle: (result: Promise<unknown>) => void } | undefined;

(crypto as { scrypt: unknown }).scrypt = (...args: unknown[]) => {
  const callback = args.pop() as ScryptCallback;
  const hold = held && --held.remaining === 0 ? held : undefined;
  if (hold) held = undefined;
  realScrypt(...args, (error: Error | null, key: Buffer) => {
    if (!hold) return callback(error, key);
    const done = hold.during();
    hold.settle(done);
    done.finally(() => callback(error, key)).catch(() => {});
  });
};
syncBuiltinESMExports();

const { addUser, CSRF, PASSWORD, sessionCookie, setup } = await import('./helpers.ts');

const CHECK = 1;
const HASH = 2;
const NEW_PASSWORD = 'reset by the owner';
const ATTACKER_PASSWORD = 'set by the attacker';

/**
 * Runs `during` when the `nth` scrypt call from now finishes, before its caller sees the result.
 * Resolves with whatever `during` returned, so a failed assertion inside it fails the test.
 */
function duringScrypt(nth: number, during: () => Promise<unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    held = { remaining: nth, during, settle: resolve };
  });
}

const anonymous = (ctx: TestContext, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  ctx.request(method, path, body, { authorization: '', ...headers });

const login = (ctx: TestContext, email: string, password: string) =>
  anonymous(ctx, 'POST', '/api/app/login', { email, password }, CSRF);

const changeBody = { current_password: PASSWORD, password: ATTACKER_PASSWORD };
const putWithCookie = (ctx: TestContext, cookie: string, body: unknown = changeBody) =>
  anonymous(ctx, 'PUT', '/api/v9/me', body, { cookie, ...CSRF });

async function resetLink(admin: TestContext, userId: number): Promise<() => Promise<void>> {
  const response = await admin.request('POST', `/api/app/admin/users/${userId}/password-reset`);
  assert.equal(response.status, 200);
  const token = ((await response.json()) as { url: string }).url.replace(/^\/reset\//, '');
  return async () => {
    const used = await anonymous(admin, 'POST', `/api/app/password-resets/${token}`, { password: NEW_PASSWORD }, CSRF);
    assert.equal(used.status, 200);
  };
}

async function assertRefused(response: Response) {
  assert.equal(response.status, 403);
  assert.equal(await response.json(), 'Incorrect username and/or password');
}

async function assertOnlyPasswordWorks(ctx: TestContext, password: string) {
  assert.equal((await login(ctx, 'bob@example.com', password)).status, 200, 'the committed password works');
  for (const other of [PASSWORD, ATTACKER_PASSWORD]) {
    assert.equal((await login(ctx, 'bob@example.com', other)).status, 403, `${other} does not`);
  }
}

for (const [phase, nth] of [['current-password check', CHECK], ['new-password hashing', HASH]] as const) {
  test(`a session's password change is refused when a reset commits during its ${phase}`, async () => {
    const admin = await setup();
    const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
    const cookie = await sessionCookie(bob);
    const useReset = await resetLink(admin, bob.user.id);

    const during = duringScrypt(nth, useReset);
    await assertRefused(await putWithCookie(admin, cookie));
    await during;
    await assertOnlyPasswordWorks(admin, NEW_PASSWORD);
  });

  test(`the later of two password changes from different sessions is refused when the first commits during its ${phase}`, async () => {
    const admin = await setup();
    const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
    const attacker = await sessionCookie(bob);
    const owner = await sessionCookie(bob);

    const during = duringScrypt(nth, async () => {
      const changed = await putWithCookie(admin, owner, { current_password: PASSWORD, password: NEW_PASSWORD });
      assert.equal(changed.status, 200);
    });
    await assertRefused(await putWithCookie(admin, attacker));
    await during;
    await assertOnlyPasswordWorks(admin, NEW_PASSWORD);
    assert.equal((await anonymous(admin, 'GET', '/api/v9/me', undefined, { cookie: owner })).status, 200, 'the owner stays signed in');
  });
}

const apiToken = (ctx: TestContext, userId: number) =>
  (ctx.db.prepare('SELECT api_token FROM users WHERE id = ?').get(userId) as { api_token: string }).api_token;

test('an API-token password change is refused when a reset commits while it hashes, and keeps the reset\'s token', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const useReset = await resetLink(admin, bob.user.id);
  let issued = '';
  const during = duringScrypt(HASH, async () => {
    await useReset();
    issued = apiToken(admin, bob.user.id);
  });
  await assertRefused(await bob.request('PUT', '/api/v9/me', changeBody));
  await during;
  assert.notEqual(issued, bob.user.api_token, 'the reset replaced the token');
  assert.equal(apiToken(admin, bob.user.id), issued, 'the refused change replaced nothing');
  assert.equal((await bob.request('GET', '/api/v9/me')).status, 403, 'the token from before the reset stops working');
  await assertOnlyPasswordWorks(admin, NEW_PASSWORD);
});

test('a timezone change committed while a password change checks the password still keeps no-time entries on their day', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user', timezone: 'Europe/Madrid' });
  const created = await bob.json('POST', `/api/v9/workspaces/${bob.wid}/time_entries`, { all_day: true, start_date: '2026-06-15', duration: 3600 });
  assert.equal(created.status, 200);
  const cookie = await sessionCookie(bob);
  const during = duringScrypt(CHECK, async () => {
    assert.equal((await bob.request('PUT', '/api/v9/me', { timezone: 'Asia/Tokyo' })).status, 200);
  });
  const changed = await putWithCookie(admin, cookie, { current_password: PASSWORD, password: NEW_PASSWORD, timezone: 'America/New_York' });
  assert.equal(changed.status, 200);
  await during;
  const stored = admin.db.prepare('SELECT start FROM time_entries WHERE id = ?').get(created.body.id) as { start: string };
  assert.equal(stored.start, '2026-06-15T04:00:00.000Z', 'midnight of the same day in New York');
});

test('a session password change is refused when an admin ends its sessions while it hashes', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const cookie = await sessionCookie(bob);
  const during = duringScrypt(HASH, async () => {
    assert.equal((await admin.request('POST', `/api/app/admin/users/${bob.user.id}/sessions/revoke`)).status, 200);
  });
  await assertRefused(await putWithCookie(admin, cookie));
  await during;
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 200, 'the password is unchanged');
});

test('an API-token password change is refused when the token is rotated while it hashes', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const cookie = await sessionCookie(bob);
  const during = duringScrypt(HASH, async () => {
    assert.equal((await anonymous(admin, 'POST', '/api/v9/me/reset_token', undefined, { cookie, ...CSRF })).status, 200);
  });
  await assertRefused(await bob.request('PUT', '/api/v9/me', changeBody));
  await during;
  assert.equal((await login(admin, 'bob@example.com', PASSWORD)).status, 200, 'the password is unchanged');
});
