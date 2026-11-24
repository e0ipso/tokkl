import { reopenDatabase } from './fixtures/database.ts';
import { settingRows, corruptSetting } from './fixtures/physical.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageFor } from './fixtures/database.ts';
import { createApp } from './fixtures/app.ts';
import { loadConfig } from '../src/config.ts';
import { sha256 } from '../src/lib/crypto.ts';
import { openDatabase, type FixtureDatabase } from './fixtures/database.ts';
import { createFirstAdmin, type User } from './fixtures/domain.ts';
import {
  CSRF,
  PASSWORD,
  addUser,
  sessionCookie,
  setTimeResolution,
  setup,
  testConfig,
  testServer,
  type TestContext,
} from './helpers.ts';

const DAY_MS = 86_400_000;
const SIGNUP_DEFAULTS = {
  signup_enabled: false,
  mail_configured: { configured: false, missing: ['TOKKL_SMTP_HOST', 'TOKKL_SMTP_FROM', 'TOKKL_PUBLIC_URL'] },
};

const MAIL_ENV = {
  TOKKL_SMTP_HOST: 'smtp.example.com',
  TOKKL_SMTP_FROM: 'Tokkl <signup@example.com>',
  TOKKL_PUBLIC_URL: 'https://tokkl.example.com',
};

function serveWith(db: FixtureDatabase, user: User, sessionDays = 30, env: NodeJS.ProcessEnv = {}) {
  const { publicUrl, smtp, mail } = loadConfig({ TOKKL_DATA_DIR: '/nonexistent', ...env }).config;
  const server = testServer(
    createApp({
      storage: storageFor(db),
      config: { ...testConfig(db), sessionDays, publicUrl, smtp, mail },
      setup: { code: null },
    }),
  );
  const authorization = `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}`;
  return async <T = any>(method: string, path: string, body?: unknown, authenticated = true) => {
    const response = await server.request(path, {
      method,
      headers: { authorization: authenticated ? authorization : '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
}

const storedRows = async (db: FixtureDatabase) =>
  Object.entries(await storageFor(db).settings.read())
    .map(([key, value]) => ({
      key: (
        {
          sessionDays: 'session_days',
          inviteDays: 'invite_days',
          signupEnabled: 'signup_enabled',
        } as Record<string, string>
      )[key],
      value: JSON.stringify(value),
    }))
    .sort((a, b) => a.key!.localeCompare(b.key!));
const storedPreferences = async (ctx: TestContext) =>
  JSON.stringify((await storageFor(ctx.db).users.get(ctx.user.id))!.preferences);

test('with nothing stored, the settings come from TOKKL_SESSION_DAYS and the invite default', async () => {
  const admin = await setup();
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, {
    session_days: 30,
    invite_days: 7,
    ...SIGNUP_DEFAULTS,
  });

  // An instance started with TOKKL_SESSION_DAYS=12 reports 12 until an admin stores a value.
  const db = await openDatabase();
  const owner = await createFirstAdmin(db, {
    email: 'owner@example.com',
    password: PASSWORD,
    fullname: '',
    timezone: 'UTC',
  });
  const response = await serveWith(db, owner, 12)('GET', '/api/app/admin/settings');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { session_days: 12, invite_days: 7, ...SIGNUP_DEFAULTS });
});

test('an admin stores settings, and they survive a restart on the same database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-settings-'));
  try {
    const path = join(dir, 'tokkl.sqlite');
    const first = await openDatabase(
      process.env.TOKKL_TEST_BACKEND && process.env.TOKKL_TEST_BACKEND !== 'sqlite' ? undefined : path,
    );
    const owner = await createFirstAdmin(first, {
      email: 'owner@example.com',
      password: PASSWORD,
      fullname: '',
      timezone: 'UTC',
    });
    const put = await serveWith(first, owner)('PUT', '/api/app/admin/settings', {
      session_days: 90,
      invite_days: 3,
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { session_days: 90, invite_days: 3, ...SIGNUP_DEFAULTS });
    const partial = await serveWith(first, owner)('PUT', '/api/app/admin/settings', { invite_days: 14 });
    assert.deepEqual(partial.body, {
      session_days: 90,
      invite_days: 14,
      ...SIGNUP_DEFAULTS,
    });
    assert.deepEqual(await settingRows(first), [
      { key: 'invite_days', value: '14', updated_by: owner.id },
      { key: 'session_days', value: '90', updated_by: owner.id },
    ]);
    await storageFor(first).close();

    const restarted = await reopenDatabase(first);
    try {
      // The env default differs, so only the stored value can produce 90.
      const get = await serveWith(restarted, owner, 45)('GET', '/api/app/admin/settings');
      assert.deepEqual(get.body, {
        session_days: 90,
        invite_days: 14,
        ...SIGNUP_DEFAULTS,
      });
    } finally {
      await storageFor(restarted).close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('out-of-range, non-integer and unknown settings return 400 and store nothing', async () => {
  const admin = await setup();
  const bodies: unknown[] = [
    { session_days: 0 },
    { session_days: 366 },
    { invite_days: 0 },
    { invite_days: 91 },
    { session_days: 1.5 },
    { session_days: '10' },
    { invite_days: null },
    { invite_days: true },
    { port: 9000 },
    { setup_code: 'x' },
    { session_days: 10, unknown: 1 },
    { session_days: 10, invite_days: 91 },
    {},
    [],
    'text',
  ];
  for (const body of bodies) {
    const response = await admin.json('PUT', '/api/app/admin/settings', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body, 'string', 'a plain error body');
  }
  assert.deepEqual(await storedRows(admin.db), []);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, {
    session_days: 30,
    invite_days: 7,
    ...SIGNUP_DEFAULTS,
  });

  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 1, invite_days: 90 })).status, 200);
  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 365, invite_days: 1 })).status, 200);
});

test('a regular user gets 403 from the settings routes, and cookie writes need the CSRF header', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  assert.equal((await bob.json('GET', '/api/app/admin/settings')).status, 403);
  assert.equal((await bob.json('PUT', '/api/app/admin/settings', { session_days: 5 })).status, 403);

  const cookie = await sessionCookie(admin);
  const noCsrf = await admin.request(
    'PUT',
    '/api/app/admin/settings',
    { session_days: 5 },
    { authorization: '', cookie },
  );
  assert.equal(noCsrf.status, 403);
  assert.deepEqual(await storedRows(admin.db), []);
  const withCsrf = await admin.request(
    'PUT',
    '/api/app/admin/settings',
    { session_days: 5 },
    {
      authorization: '',
      cookie,
      'x-tokkl-csrf': '1',
    },
  );
  assert.equal(withCsrf.status, 200);
});

test('the time resolution is no instance setting: admins cannot store it and /me does not carry it', async () => {
  const admin = await setup();
  for (const body of [{ time_resolution_minutes: 15 }, { session_days: 10, time_resolution_minutes: 15 }]) {
    const response = await admin.json('PUT', '/api/app/admin/settings', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body, 'Unknown setting: time_resolution_minutes');
  }
  assert.deepEqual(await storedRows(admin.db), []);
  assert.equal(
    Object.hasOwn((await admin.json('GET', '/api/app/admin/settings')).body, 'time_resolution_minutes'),
    false,
  );
  for (const path of ['/api/v9/me', '/api/v9/me?with_related_data=true'])
    assert.equal(Object.hasOwn((await admin.json('GET', path)).body, 'time_resolution_minutes'), false, path);
});

// The time resolution is a set of allowed values, the divisors of an hour, rather than a range.
test('each user stores a divisor of 60 as time_resolution_minutes and reads 5 for anything else', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const resolutionOf = async (ctx: TestContext) =>
    (await ctx.json('GET', '/api/app/me/preferences')).body.time_resolution_minutes;
  assert.equal(await resolutionOf(bob), 5);

  for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
    const saved = await bob.json('POST', '/api/app/me/preferences', { time_resolution_minutes: minutes });
    assert.equal(saved.status, 200, String(minutes));
    assert.equal(await resolutionOf(bob), minutes);
  }
  await setTimeResolution(bob, 15);
  const stored = await storedPreferences(bob);
  for (const value of [0, 7, 61, 5.5, '15', null, true]) {
    const response = await bob.request('POST', '/api/app/me/preferences', { time_resolution_minutes: value });
    assert.equal(response.status, 400, String(value));
    assert.equal(response.headers.get('tokkl-error-code'), 'invalid_preference');
    assert.equal(response.headers.get('tokkl-error-field'), 'time_resolution_minutes');
    assert.equal(
      await response.json(),
      'Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60',
    );
  }
  assert.equal(await storedPreferences(bob), stored);
  assert.equal(await resolutionOf(bob), 15);
  assert.equal(await resolutionOf(admin), 5, "one user's preference leaves the others alone");

  // Values stored before the rule existed read back as the default.
  for (const value of [7, 0, 5.5, '15', null]) {
    await storageFor(bob.db).users.setPreferences(bob.user.id, { time_resolution_minutes: value });
    assert.equal(await resolutionOf(bob), 5, JSON.stringify(value));
  }
});

test('a new login uses the stored session_days, and earlier sessions keep their expiry', async () => {
  const admin = await setup();
  const expiryOf = async (cookie: string) => {
    const token = cookie.split('=')[1]!;
    const row = (await storageFor(admin.db).sessions.find(sha256(token)))!;
    return Date.parse(row.expiresAt) - Date.parse(row.createdAt);
  };

  const before = await sessionCookie(admin);
  assert.equal(await expiryOf(before), 30 * DAY_MS);

  assert.equal((await admin.json('PUT', '/api/app/admin/settings', { session_days: 2 })).status, 200);
  const login = await admin.request(
    'POST',
    '/api/app/login',
    { email: admin.user.email, password: PASSWORD },
    { authorization: '', ...CSRF },
  );
  assert.equal(login.status, 200);
  const after = login.headers.get('set-cookie')!;
  const cookieExpires = Date.parse(/expires=([^;]+)/i.exec(after)![1]!);
  assert.ok(Math.abs(cookieExpires - (Date.now() + 2 * DAY_MS)) < 60_000, 'the cookie expires in two days');
  assert.equal(await expiryOf(after.split(';')[0]!), 2 * DAY_MS);
  assert.equal(await expiryOf(before), 30 * DAY_MS, 'the earlier session is unchanged');
});

test('sign-up is off by default and reports only missing mail variable names to admins', async () => {
  const admin = await setup();
  const settings = await admin.json('GET', '/api/app/admin/settings');
  assert.equal(settings.body.signup_enabled, false);
  assert.deepEqual(settings.body.mail_configured, {
    configured: false,
    missing: ['TOKKL_SMTP_HOST', 'TOKKL_SMTP_FROM', 'TOKKL_PUBLIC_URL'],
  });
  const request = serveWith(admin.db, admin.user);
  const status = await request('GET', '/api/app/status', undefined, false);
  assert.equal(status.status, 200);
  assert.equal(status.body.signup_enabled, false);
  assert.equal(status.body.setup_required, false);
  assert.equal(Object.hasOwn(status.body, 'mail_configured'), false);
  const me = await admin.json('GET', '/api/v9/me');
  assert.equal(Object.hasOwn(me.body, 'mail_configured'), false);
});

test('sign-up can be enabled with mail, persists across app restarts, and can always be disabled', async () => {
  const admin = await setup();
  const request = serveWith(admin.db, admin.user, 30, MAIL_ENV);
  const enabled = await request('PUT', '/api/app/admin/settings', { signup_enabled: true });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.signup_enabled, true);
  assert.deepEqual(enabled.body.mail_configured, { configured: true, missing: [] });
  assert.equal((await request('GET', '/api/app/status', undefined, false)).body.signup_enabled, true);
  const restarted = serveWith(admin.db, admin.user, 30, MAIL_ENV);
  assert.equal((await restarted('GET', '/api/app/admin/settings')).body.signup_enabled, true);
  assert.equal((await restarted('GET', '/api/app/status', undefined, false)).body.signup_enabled, true);

  const withoutMail = serveWith(admin.db, admin.user);
  assert.equal((await withoutMail('GET', '/api/app/admin/settings')).body.signup_enabled, true);
  assert.equal((await withoutMail('GET', '/api/app/status', undefined, false)).body.signup_enabled, false);
  const disabled = await withoutMail('PUT', '/api/app/admin/settings', { signup_enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.signup_enabled, false);
  assert.equal((await request('GET', '/api/app/status', undefined, false)).body.signup_enabled, false);
});

test('enabling sign-up without mail names every missing variable and stores no partial changes', async () => {
  for (const env of [
    {},
    { TOKKL_SMTP_FROM: MAIL_ENV.TOKKL_SMTP_FROM },
    { ...MAIL_ENV, TOKKL_SMTP_HOST: undefined },
    { ...MAIL_ENV, TOKKL_SMTP_FROM: undefined },
    { ...MAIL_ENV, TOKKL_PUBLIC_URL: undefined },
  ]) {
    const admin = await setup();
    const request = serveWith(admin.db, admin.user, 30, env);
    const missing = loadConfig({ TOKKL_DATA_DIR: '/nonexistent', ...env }).config.mail.missing;
    const enabled = await request('PUT', '/api/app/admin/settings', { invite_days: 9, signup_enabled: true });
    assert.equal(enabled.status, 400);
    assert.equal(enabled.body, `Sign-up needs ${missing.join(' and ')}`);
    assert.deepEqual(await storedRows(admin.db), []);
    assert.deepEqual((await request('GET', '/api/app/admin/settings')).body.mail_configured, {
      configured: false,
      missing,
    });
    assert.equal((await request('PUT', '/api/app/admin/settings', { signup_enabled: false })).status, 200);
    assert.equal((await request('GET', '/api/app/status', undefined, false)).body.signup_enabled, false);
  }
});

test('sign-up accepts only booleans and mail state remains read-only', async () => {
  const admin = await setup();
  const request = serveWith(admin.db, admin.user, 30, MAIL_ENV);
  for (const signup_enabled of ['true', 'false', 0, 1, null, [], {}]) {
    const response = await request('PUT', '/api/app/admin/settings', { signup_enabled });
    assert.equal(response.status, 400);
    assert.equal(response.body, 'Invalid signup_enabled: expected true or false');
  }
  const readOnly = await request('PUT', '/api/app/admin/settings', { mail_configured: { configured: true } });
  assert.equal(readOnly.status, 400);
  assert.equal(readOnly.body, 'Unknown setting: mail_configured');
  const empty = await request('PUT', '/api/app/admin/settings', {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body, 'Expected session_days or invite_days or signup_enabled');
  assert.deepEqual(await storedRows(admin.db), []);
});

test('a stored non-boolean sign-up value falls back to false even with mail configured', async () => {
  const admin = await setup();
  const request = serveWith(admin.db, admin.user, 30, MAIL_ENV);
  for (const value of ['1', '0', '"true"', 'null', '{}', 'not json']) {
    await corruptSetting(admin.db, 'signup_enabled', value);
    assert.equal((await request('GET', '/api/app/admin/settings')).body.signup_enabled, false, value);
    assert.equal((await request('GET', '/api/app/status', undefined, false)).body.signup_enabled, false, value);
  }
});
