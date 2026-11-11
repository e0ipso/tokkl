import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { loadConfig, type Config } from '../src/config.ts';
import type { Mailer } from '../src/mail.ts';
import { composeApp } from './fixtures/app.ts';
import { storageFor } from './fixtures/database.ts';
import { addUser, CSRF, recordLogs, setup, testConfig, testServer } from './helpers.ts';

const PUBLIC_URL = 'https://tokkl.example.com';
type Message = Parameters<Mailer['send']>[0];

test('signup rejects address metadata that SMTP would interpret as another mailbox identity', async t => {
  const { signup, messages, services } = await signupApp(t);
  const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
  const addresses = [
    'victim@example.com(any-comment)',
    'victim(any-comment)@example.com',
    'Victim<victim@example.com>',
    '<victim@example.com>',
    'victim@example.com,',
    'victim@example.com;',
    'group:victim@example.com;',
    '"victim"@example.com',
    'victim@éxample.com',
  ];
  for (const [index, email] of addresses.entries()) {
    const response = await signup({ email }, { 'x-forwarded-for': `203.0.113.${index + 1}` });
    assert.equal(response.status, 400, email);
    assert.equal(await response.json(), 'Enter a valid email address');
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(messages.length, 0);
  const email = "O'Reilly+news@example.com";
  assert.equal((await signup({ email }, { 'x-forwarded-for': '203.0.113.100' })).status, 202);
  assert.equal(messages[0]!.to, email);
});

test('a cleanup failure still returns a safe 503 and logs fixed messages without SMTP or storage details', async t => {
  const logs = recordLogs(t);
  const { signup, services } = await signupApp(t, {
    mailer: {
      send: async () => {
        throw new Error('smtp-secret');
      },
    },
  });
  t.mock.method(services.signupInvites, 'deleteSignupInvite', async () => {
    throw new Error('storage-secret');
  });
  const response = await signup({ email: 'private@example.com' });
  assert.equal(response.status, 503);
  assert.equal(await response.json(), 'Could not send the email. Try again later.');
  assert.ok(logs.some(line => line.msg === 'Sign-up email failed'));
  assert.ok(logs.some(line => line.msg === 'Sign-up invite cleanup failed'));
  for (const secret of ['smtp-secret', 'storage-secret', 'private@example.com'])
    assert.ok(!JSON.stringify(logs).includes(secret));
});

test('failed sends return a safe 503, remove only unsent invites, and count toward both limits', async t => {
  const logs = recordLogs(t);
  const attempted: Message[] = [];
  const { signup, services, adminRequest, server } = await signupApp(t, {
    mailer: {
      send: async message => {
        attempted.push(message);
        throw new Error(`SMTP password smtp-secret for ${message.to}: ${message.text}`);
      },
    },
  });
  const other = await services.signupInvites.createSignupInvite('other@example.com');
  assert.ok(!other.existing);
  const adminInvite = await adminRequest('POST', '/api/app/admin/invites', { role: 'user' });
  assert.equal(adminInvite.status, 200);
  const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
  const cleanup = t.mock.method(services.signupInvites, 'deleteSignupInvite');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (const email of ['unsent@example.com', 'me@example.com', 'UNSENT@example.com', 'unsent@example.com']) {
    const response = await signup({ email });
    assert.equal(response.status, 503);
    assert.equal(await response.json(), 'Could not send the email. Try again later.');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(attempted.length, 4);
  assert.equal(cleanup.mock.callCount(), 3, 'existing accounts create nothing to compensate');
  const emailBlocked = await signup({ email: 'unsent@example.com' });
  assert.equal(emailBlocked.status, 429);
  assert.equal(emailBlocked.headers.get('retry-after'), '3600');
  const addressBlocked = await signup({ email: 'another@example.com' });
  assert.equal(addressBlocked.status, 429);
  assert.equal(addressBlocked.headers.get('retry-after'), '900');
  assert.equal(lookup.mock.callCount(), 4);
  assert.equal(attempted.length, 4);
  for (const message of attempted.filter(message => message.subject === 'Your Tokkl sign-up link')) {
    const token = message.text.match(/\/invite\/([A-Za-z0-9_-]{43})/)![1];
    assert.equal((await server.request(`/api/app/invites/${token}`)).status, 404);
    assert.ok(!JSON.stringify(logs).includes(token!));
  }
  assert.equal((await server.request(`/api/app/invites/${other.token}`)).status, 200);
  const listed = await adminRequest('GET', '/api/app/admin/invites', undefined);
  const invites = (await listed.json()) as Array<{ email: string | null }>;
  assert.deepEqual(
    invites.map(row => row.email),
    ['other@example.com', null],
  );
  assert.ok(logs.some(line => line.msg === 'Sign-up email failed'));
  for (const secret of ['unsent@example.com', 'me@example.com', 'smtp-secret', 'SMTP password'])
    assert.ok(!JSON.stringify(logs).includes(secret));
});

test('a failed overlapping send compensates its own invite and preserves the newer delivered link', async t => {
  recordLogs(t);
  let failSend!: () => void;
  let started!: () => void;
  const sending = new Promise<void>(resolve => {
    started = resolve;
  });
  const failed = new Promise<void>(resolve => {
    failSend = resolve;
  });
  const attempted: Message[] = [];
  const { signup, server } = await signupApp(t, {
    mailer: {
      send: async message => {
        attempted.push(message);
        if (attempted.length === 1) {
          started();
          await failed;
          throw new Error('Mail delivery failed');
        }
      },
    },
  });
  const first = signup({ email: 'overlap@example.com' });
  try {
    await sending;
    assert.equal((await signup({ email: 'OVERLAP@example.com' })).status, 202);
  } finally {
    failSend();
  }
  assert.equal((await first).status, 503);
  assert.equal(attempted.length, 2);
  const [firstToken, secondToken] = attempted.map(message => message.text.match(/\/invite\/([A-Za-z0-9_-]{43})/)![1]);
  assert.equal((await server.request(`/api/app/invites/${firstToken}`)).status, 404);
  assert.equal((await server.request(`/api/app/invites/${secondToken}`)).status, 200);
});

test('signup rejects missing, malformed, header-injecting and oversized emails before account lookup', async t => {
  const { signup, messages, services } = await signupApp(t);
  const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
  const invalid = [
    {},
    ...[
      null,
      5,
      '',
      'a@@example.com',
      'a @example.com',
      'a@example.com\r\nBcc: b@example.com',
      `${'x'.repeat(244)}@example.com`,
    ].map(email => ({ email })),
  ];
  for (const [index, body] of invalid.entries()) {
    const response = await signup(body, { 'x-forwarded-for': `203.0.113.${index + 1}` });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(await response.json(), 'Enter a valid email address');
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(messages.length, 0);
  const email = `${'x'.repeat(243)}@example.com`;
  assert.equal(email.length, 255);
  assert.equal((await signup({ email }, { 'x-forwarded-for': '203.0.113.100' })).status, 202);
  assert.equal(messages.length, 1);
});

test('the normalized email limit is shared across apps, counts successful requests and lasts one hour', async t => {
  const { admin, signup, messages, services, config } = await signupApp(t);
  const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (let i = 0; i < 3; i++) {
    assert.equal(
      (await signup({ email: '  SAME@Example.com  ' }, { 'x-forwarded-for': `203.0.113.${i + 1}` })).status,
      202,
    );
  }
  assert.equal(messages.length, 3);
  const restarted = composeApp({
    storage: storageFor(admin.db),
    config,
    setup: { code: null },
    mailer: { send: async message => void messages.push(message) },
  });
  t.after(() => restarted.close());
  const restartedLookup = t.mock.method(restarted.services.signupInvites, 'createSignupInvite');
  const server = testServer(restarted.app);
  const request = () =>
    server.request('/api/app/signup', {
      method: 'POST',
      headers: { ...CSRF, 'x-forwarded-for': '203.0.113.200' },
      body: JSON.stringify({ email: 'same@example.COM' }),
    });
  const blocked = await request();
  assert.equal(blocked.status, 429);
  assert.equal(await blocked.json(), 'Too many sign-up requests, try again later');
  assert.equal(blocked.headers.get('retry-after'), '3600');
  t.mock.timers.tick(15 * 60 * 1000);
  const stillBlocked = await request();
  assert.equal(stillBlocked.status, 429);
  assert.equal(stillBlocked.headers.get('retry-after'), '2700');
  assert.equal(lookup.mock.callCount(), 3);
  assert.equal(restartedLookup.mock.callCount(), 0);
  assert.equal(messages.length, 3);
  t.mock.timers.tick(45 * 60 * 1000);
  assert.equal((await request()).status, 202);
  assert.equal(messages.length, 4);
});

test('the address limit counts invalid and accepted requests and uses only trusted proxy addresses', async t => {
  for (const trustProxy of [false, 1] as const) {
    const { signup, messages, services } = await signupApp(t, { config: { trustProxy } });
    const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    for (let i = 0; i < 5; i++) {
      const response = await signup(
        { email: i < 2 ? 'invalid' : `person${i}@example.com` },
        {
          'x-forwarded-for': `10.0.0.${i + 1}, 203.0.113.1`,
        },
      );
      assert.equal(response.status, i < 2 ? 400 : 202);
    }
    const blocked = await signup({ email: 'blocked@example.com' }, { 'x-forwarded-for': '10.0.0.100, 203.0.113.1' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal(lookup.mock.callCount(), 3);
    assert.equal(messages.length, 3);
    assert.equal(
      (await signup({ email: 'other@example.com' }, { 'x-forwarded-for': '203.0.113.2' })).status,
      trustProxy ? 202 : 429,
    );
    t.mock.timers.tick(15 * 60 * 1000);
    assert.equal(
      (await signup({ email: 'after-reset@example.com' }, { 'x-forwarded-for': '203.0.113.1' })).status,
      202,
    );
    t.mock.timers.reset();
  }
});

async function signupApp(
  t: TestContext,
  options: { enabled?: boolean; config?: Partial<Config>; mailer?: Mailer } = {},
) {
  const admin = await setup();
  const messages: Message[] = [];
  const { publicUrl, smtp, mail } = loadConfig({
    TOKKL_DATA_DIR: '/nonexistent',
    TOKKL_SMTP_HOST: 'smtp.example.com',
    TOKKL_SMTP_FROM: 'Tokkl <signup@example.com>',
    TOKKL_PUBLIC_URL: PUBLIC_URL,
  }).config;
  const config = { ...testConfig(admin.db), publicUrl, smtp, mail, trustProxy: 1, ...options.config };
  const application = composeApp({
    storage: storageFor(admin.db),
    config,
    setup: { code: null },
    mailer: options.mailer ?? { send: async message => void messages.push(message) },
  });
  t.after(() => application.close());
  const server = testServer(application.app);
  const adminRequest = (method: string, path: string, body: unknown) =>
    server.request(path, {
      method,
      headers: { authorization: `Basic ${Buffer.from(`${admin.user.apiToken}:api_token`).toString('base64')}` },
      body: JSON.stringify(body),
    });
  if (options.enabled !== false) {
    const enabled = await adminRequest('PUT', '/api/app/admin/settings', { signup_enabled: true, invite_days: 3 });
    assert.equal(enabled.status, 200, await enabled.text());
  }
  const signup = (body: unknown, headers: Record<string, string> = {}) =>
    server.request('/api/app/signup', {
      method: 'POST',
      headers: { ...CSRF, ...headers },
      body: JSON.stringify(body),
    });
  return { admin, messages, server, signup, adminRequest, services: application.services, config };
}

test('signup requires CSRF before checking availability, and is hidden when ineffective', async t => {
  const { signup, messages, adminRequest, services, admin, config } = await signupApp(t, { enabled: false });
  const lookup = t.mock.method(services.signupInvites, 'createSignupInvite');
  const noCsrf = await signup({}, { 'x-tokkl-csrf': '' });
  assert.equal(noCsrf.status, 403);
  assert.equal(await noCsrf.json(), 'Missing CSRF header');
  const off = await signup({ email: 'new@example.com' });
  assert.equal(off.status, 404);
  assert.equal(await off.json(), 'Not found');
  assert.equal((await adminRequest('PUT', '/api/app/admin/settings', { signup_enabled: true })).status, 200);
  assert.equal((await signup({ email: 'new@example.com' }, { 'x-tokkl-csrf': '' })).status, 403);
  assert.equal(messages.length, 0);
  assert.equal(lookup.mock.callCount(), 0);
  for (const missing of [
    { publicUrl: undefined, mail: { configured: false, missing: ['TOKKL_PUBLIC_URL'] } },
    { smtp: undefined, mail: { configured: false, missing: ['TOKKL_SMTP_HOST'] } },
  ]) {
    const restarted = composeApp({
      storage: storageFor(admin.db),
      config: { ...config, ...missing },
      setup: { code: null },
      mailer: { send: async message => void messages.push(message) },
    });
    t.after(() => restarted.close());
    const response = await testServer(restarted.app).request('/api/app/signup', {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    assert.equal(response.status, 404);
    assert.equal(await response.json(), 'Not found');
  }
  assert.equal(messages.length, 0);
});

test('unknown, existing and disabled emails get identical replies and one mail each; links use the public URL', async t => {
  const { admin, messages, signup, server, adminRequest } = await signupApp(t);
  const disabled = await addUser(admin, { email: 'disabled@example.com', role: 'user' });
  assert.equal(
    (await adminRequest('PATCH', `/api/app/admin/users/${disabled.user.id}`, { disabled: true })).status,
    200,
  );
  const replies = [];
  for (const email of ['  New.Person@Example.com  ', '  ME@EXAMPLE.COM  ', 'DISABLED@example.com']) {
    const response = await signup(
      { email },
      { host: 'attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' },
    );
    replies.push({ status: response.status, body: await response.text(), type: response.headers.get('content-type') });
  }
  assert.deepEqual(replies[0], { status: 202, body: '{"ok":true}', type: 'application/json; charset=utf-8' });
  assert.deepEqual(replies[1], replies[0]);
  assert.deepEqual(replies[2], replies[0]);
  assert.equal(messages.length, 3);
  const [invite, existing, suspended] = messages as [Message, Message, Message];
  assert.equal(invite.to, 'New.Person@Example.com');
  assert.equal(invite.subject, 'Your Tokkl sign-up link');
  assert.match(invite.text, /3 days/);
  const link = invite.text.match(/https:\/\/\S+\/invite\/([A-Za-z0-9_-]{43})/);
  assert.ok(link);
  assert.equal(link[0], `${PUBLIC_URL}/invite/${link[1]}`);
  assert.ok(!invite.text.includes('attacker.example'));
  const info = await server.request(`/api/app/invites/${link[1]}`);
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), { role: 'user', email: 'new.person@example.com' });
  for (const notice of [existing, suspended]) {
    assert.equal(notice.subject, 'Your Tokkl account');
    assert.match(notice.text, /already has an account/);
    assert.match(notice.text, /admin.*password reset link/);
    assert.ok(!notice.text.includes('/invite/'));
  }
  const listed = await adminRequest('GET', '/api/app/admin/invites', undefined);
  const invites = (await listed.json()) as Array<{ email: string }>;
  assert.deepEqual(
    invites.map(row => row.email),
    ['new.person@example.com'],
  );
});
