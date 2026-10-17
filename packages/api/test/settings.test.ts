import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { sha256 } from '../src/auth/crypto.ts';
import { openDatabase, type Db } from '../src/db/index.ts';
import { createFirstAdmin, type UserRow } from '../src/models/users.ts';
import { CSRF, PASSWORD, addUser, sessionCookie, setup, testConfig, testServer } from './helpers.ts';

const DAY_MS = 86_400_000;

/** Serves `db` with its own config and returns a GET/PUT client signed in as `user` by API token. */
function serveWith(db: Db, user: UserRow, sessionDays = 30) {
  const server = testServer(createApp({ db, config: { ...testConfig(), sessionDays }, setup: { code: null } }));
  const authorization = `Basic ${Buffer.from(`${user.api_token}:api_token`).toString('base64')}`;
  return async (method: string, path: string, body?: unknown) => {
    const response = await server.request(path, {
      method, headers: { authorization }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}

const storedRows = (db: Db) => db.prepare('SELECT key, value, updated_by FROM instance_settings ORDER BY key').all()
  .map((row) => ({ ...row }));

test('with nothing stored, the settings come from TOKKL_SESSION_DAYS and the invite default', async () => {
  const admin = await setup();
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, { session_days: 30, invite_days: 7, time_resolution_minutes: 5 });

  // An instance started with TOKKL_SESSION_DAYS=12 reports 12 until an admin stores a value.
  const db = openDatabase(':memory:');
  const owner = await createFirstAdmin(db, { email: 'owner@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' });
  const response = await serveWith(db, owner, 12)('GET', '/api/app/admin/settings');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { session_days: 12, invite_days: 7, time_resolution_minutes: 5 });
});

test('an admin stores settings, and they survive a restart on the same database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-settings-'));
  try {
    const path = join(dir, 'tokkl.sqlite');
    const first = openDatabase(path);
    const owner = await createFirstAdmin(first, { email: 'owner@example.com', password: PASSWORD, fullname: '', timezone: 'UTC' });
    const put = await serveWith(first, owner)('PUT', '/api/app/admin/settings', {
      session_days: 90, invite_days: 3, time_resolution_minutes: 15,
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { session_days: 90, invite_days: 3, time_resolution_minutes: 15 });
    // One key at a time keeps the others.
    const partial = await serveWith(first, owner)('PUT', '/api/app/admin/settings', { invite_days: 14 });
    assert.deepEqual(partial.body, { session_days: 90, invite_days: 14, time_resolution_minutes: 15 });
    assert.deepEqual(storedRows(first), [
      { key: 'invite_days', value: '14', updated_by: owner.id },
      { key: 'session_days', value: '90', updated_by: owner.id },
      { key: 'time_resolution_minutes', value: '15', updated_by: owner.id },
    ]);
    first.close();

    const restarted = openDatabase(path);
    try {
      // The env default differs, so only the stored value can produce 90.
      const get = await serveWith(restarted, owner, 45)('GET', '/api/app/admin/settings');
      assert.deepEqual(get.body, { session_days: 90, invite_days: 14, time_resolution_minutes: 15 });
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('out-of-range, non-integer and unknown settings return 400 and store nothing', async () => {
  const admin = await setup();
  const bodies: unknown[] = [
    { session_days: 0 }, { session_days: 366 }, { invite_days: 0 }, { invite_days: 91 },
    { session_days: 1.5 }, { session_days: '10' }, { invite_days: null }, { invite_days: true },
    { port: 9000 }, { setup_code: 'x' }, { session_days: 10, unknown: 1 }, { session_days: 10, invite_days: 91 },
    {}, [], 'text',
  ];
  for (const body of bodies) {
    const response = await admin.json('PUT', '/api/app/admin/settings', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body, 'string', 'a plain error body');
  }
  assert.deepEqual(storedRows(admin.db), []);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, { session_days: 30, invite_days: 7, time_resolution_minutes: 5 });

  // The bounds themselves are accepted.
  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 1, invite_days: 90 })).status, 200);
  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 365, invite_days: 1 })).status, 200);
});

test('a regular user gets 403 from the settings routes, and cookie writes need the CSRF header', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  assert.equal((await bob.json('GET', '/api/app/admin/settings')).status, 403);
  assert.equal((await bob.json('PUT', '/api/app/admin/settings', { session_days: 5 })).status, 403);

  const cookie = await sessionCookie(admin);
  const noCsrf = await admin.request('PUT', '/api/app/admin/settings', { session_days: 5 }, { authorization: '', cookie });
  assert.equal(noCsrf.status, 403);
  assert.deepEqual(storedRows(admin.db), []);
  const withCsrf = await admin.request('PUT', '/api/app/admin/settings', { session_days: 5 }, {
    authorization: '', cookie, 'x-tokkl-csrf': '1',
  });
  assert.equal(withCsrf.status, 200);
});

// The time resolution is a set of allowed values, the divisors of an hour, rather than a range.
test('time_resolution_minutes accepts every divisor of 60 and nothing else', async () => {
  const admin = await setup();
  for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
    const put = await admin.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: minutes });
    assert.equal(put.status, 200, String(minutes));
    assert.equal((await admin.json('GET', '/api/app/admin/settings')).body.time_resolution_minutes, minutes);
  }

  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 15 })).status, 200);
  const stored = storedRows(admin.db);
  const bodies: unknown[] = [
    { time_resolution_minutes: 0 }, { time_resolution_minutes: 7 }, { time_resolution_minutes: 61 },
    { time_resolution_minutes: -5 }, { time_resolution_minutes: 120 }, { time_resolution_minutes: 5.5 },
    { time_resolution_minutes: '15' }, { time_resolution_minutes: null }, { time_resolution_minutes: true },
    // A valid field in the same request is not stored either.
    { session_days: 10, invite_days: 3, time_resolution_minutes: 7 },
  ];
  for (const body of bodies) {
    const response = await admin.json('PUT', '/api/app/admin/settings', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body, 'Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60');
  }
  assert.deepEqual(storedRows(admin.db), stored);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, {
    session_days: 30, invite_days: 7, time_resolution_minutes: 15,
  });
});

test('a stored time resolution outside the allowed values reads back as the default', async () => {
  const admin = await setup();
  for (const value of ['7', '0', '5.5', '"15"', 'null', 'not json']) {
    admin.db.prepare(`
      INSERT INTO instance_settings (key, value, updated_at, updated_by) VALUES ('time_resolution_minutes', ?, '2026-01-01T00:00:00Z', NULL)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run(value);
    assert.equal((await admin.json('GET', '/api/app/admin/settings')).body.time_resolution_minutes, 5, value);
    assert.equal((await admin.json('GET', '/api/v9/me')).body.time_resolution_minutes, 5, value);
  }
});

// Every signed-in client learns the resolution from /api/v9/me; only an admin can change it.
test('a regular user cannot change the time resolution and reads its effective value on /api/v9/me', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  assert.equal((await bob.json('GET', '/api/v9/me')).body.time_resolution_minutes, 5);

  assert.equal((await bob.json('GET', '/api/app/admin/settings')).status, 403);
  assert.equal((await bob.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 30 })).status, 403);
  assert.deepEqual(storedRows(admin.db), []);
  assert.equal((await bob.json('GET', '/api/v9/me')).body.time_resolution_minutes, 5);

  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 15 })).status, 200);
  assert.equal((await bob.json('GET', '/api/v9/me')).body.time_resolution_minutes, 15);
  assert.equal((await bob.json('GET', '/api/v9/me?with_related_data=true')).body.time_resolution_minutes, 15);
  assert.equal((await admin.json('GET', '/api/v9/me')).body.time_resolution_minutes, 15);
});

test('a new login uses the stored session_days, and earlier sessions keep their expiry', async () => {
  const admin = await setup();
  const expiryOf = (cookie: string) => {
    const token = cookie.split('=')[1]!;
    const row = admin.db.prepare('SELECT created_at, expires_at FROM sessions WHERE token_hash = ?')
      .get(sha256(token)) as { created_at: string; expires_at: string };
    return Date.parse(row.expires_at) - Date.parse(row.created_at);
  };

  const before = await sessionCookie(admin);
  assert.equal(expiryOf(before), 30 * DAY_MS);

  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 2 })).status, 200);
  const login = await admin.request('POST', '/api/app/login', { email: admin.user.email, password: PASSWORD }, { authorization: '', ...CSRF });
  assert.equal(login.status, 200);
  const after = login.headers.get('set-cookie')!;
  const cookieExpires = Date.parse(/expires=([^;]+)/i.exec(after)![1]!);
  assert.ok(Math.abs(cookieExpires - (Date.now() + 2 * DAY_MS)) < 60_000, 'the cookie expires in two days');
  assert.equal(expiryOf(after.split(';')[0]!), 2 * DAY_MS);
  assert.equal(expiryOf(before), 30 * DAY_MS, 'the earlier session is unchanged');
});
