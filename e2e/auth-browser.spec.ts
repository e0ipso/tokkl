import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { request, type Page } from '@playwright/test';
import { EMAIL, PASSWORD } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  ACCOUNT, CSRF, LIMIT_WINDOW_SECONDS, SETUP_CODE, acceptInvite, basic, createAccount, createInvite, expect,
  inviteApiPath, logInThroughForm, meWithSession, retryAfter, sessionCookie, test,
} from './auth-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

// Failed setup and login in the browser, and what logout leaves behind.

test('a wrong setup code shows an error, and a retry with the right code creates the account', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  runtimeErrors.allowResponse({ status: 403, method: 'POST', path: /^\/api\/app\/setup$/, reason: 'the first attempt sends a wrong setup code' });

  await page.goto(server.baseURL);
  await expect(page.getByRole('heading', { name: 'Create the first admin' })).toBeVisible();
  await expect(page.getByText("This creates the server's first administrator. You can invite more people afterwards.")).toBeVisible();
  await page.getByLabel('Setup code').fill('WRONG-CODE');
  await page.getByLabel('Name').fill(ACCOUNT.fullname);
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password').fill(ACCOUNT.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();

  await expect(page.getByRole('alert')).toHaveText('Invalid setup code. It is printed in the server log on startup.');
  await expect(page.getByRole('heading', { name: 'Create the first admin' })).toBeVisible();
  expect(await (await page.request.get(`${server.baseURL}/api/app/status`)).json()).toEqual({ setup_required: true });
  expect((await page.context().cookies(server.baseURL)).some((c) => c.name === 'tokkl_session')).toBe(false);

  // The form keeps what was typed, so only the code needs fixing.
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const me = await page.request.get(`${server.baseURL}/api/v9/me`);
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(ACCOUNT.email);
});

// The setup error points at the server log, so the log must carry the code until the first admin exists.
test('the startup log prints the setup code until the first admin exists', async ({ servers }) => {
  const SETUP_LINE = `No admin account yet. Open the web UI and use this setup code to create it: ${SETUP_CODE}`;
  const fresh = await servers.start({ slot: 0 });
  await expect.poll(() => fresh.output()).toContain(SETUP_LINE);
  await createAccount(fresh.baseURL);
  await fresh.stop();

  const restarted = await servers.start({ slot: 0, dataDir: fresh.dataDir });
  await expect.poll(() => restarted.output()).toContain('tokkl listening on');
  expect(restarted.output()).not.toContain(SETUP_CODE);
  expect(restarted.output()).not.toContain('No admin account yet');
});

// Older servers stored the zone as typed. The server that opens such a database stores the canonical name.
test('a restart on an older database shows a zone stored as typed under its canonical name', async ({ page, servers }) => {
  const old = await servers.start({ slot: 0 });
  await createAccount(old.baseURL);
  await old.stop();
  const db = new DatabaseSync(join(old.dataDir, 'tokkl.sqlite'));
  try {
    db.prepare('UPDATE users SET timezone = ? WHERE email = ?').run('asia/tokyo', ACCOUNT.email);
    db.exec('PRAGMA user_version = 5');
  } finally {
    db.close();
  }

  const upgraded = await servers.start({ slot: 0, dataDir: old.dataDir });
  await logInThroughForm(page, upgraded.baseURL);
  expect((await (await page.request.get(`${upgraded.baseURL}/api/v9/me`)).json()).timezone).toBe('Asia/Tokyo');
  await page.goto(`${upgraded.baseURL}/settings`);
  const profile = page.getByRole('form', { name: 'Profile' });
  await expect(profile.getByLabel('Timezone')).toHaveValue('Asia/Tokyo');
  await expect(profile.getByRole('note')).toContainText('This browser is set to Europe/Madrid, but the account uses Asia/Tokyo.');
});

// Ten wrong setup codes from one address refuse even the right one, and the 429 says when to retry.
test('ten wrong setup codes lock setup on this address, and the setup form says so', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  runtimeErrors.allowResponse({ status: 429, method: 'POST', path: /^\/api\/app\/setup$/, reason: 'this address sent ten wrong setup codes' });
  for (let i = 0; i < 10; i++) {
    const wrong = await page.request.post(`${server.baseURL}/api/app/setup`, { headers: CSRF, data: { setup_code: 'WRONG-CODE', ...ACCOUNT } });
    expect(wrong.status()).toBe(403);
  }

  await page.goto(server.baseURL);
  await expect(page.getByRole('heading', { name: 'Create the first admin' })).toBeVisible();
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByLabel('Name').fill(ACCOUNT.fullname);
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password').fill(ACCOUNT.password);
  const locked = page.waitForResponse((r) => r.url() === `${server.baseURL}/api/app/setup` && r.status() === 429);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  expect(retryAfter(await locked)).toBeGreaterThan(LIMIT_WINDOW_SECONDS - 60);
  await expect(page.getByRole('alert')).toHaveText('Too many failed attempts, try again later');
  expect(await (await page.request.get(`${server.baseURL}/api/app/status`)).json()).toEqual({ setup_required: true });
});

test('wrong credentials show an error and keep the browser logged out until a valid retry', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 403, method: 'POST', path: /^\/api\/app\/login$/, reason: 'the first two attempts use a wrong password and an unknown email' });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  const alert = page.getByRole('alert');

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(alert).toHaveText('Incorrect email or password');

  // An unknown email gets the same message, so the form does not reveal which accounts exist.
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(alert).toHaveText('Incorrect email or password');

  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect((await page.context().cookies()).some((c) => c.name === 'tokkl_session')).toBe(false);
  expect((await page.request.get('/api/v9/me')).status()).toBe(403);

  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect((await page.request.get('/api/v9/me')).status()).toBe(200);
});

test('after logout the old session is refused, and reload or back shows no private data', async ({ page, data, baseURL }) => {
  const description = 'Private: salary review notes';
  const start = new Date(Date.now() - 2 * 3_600_000);
  await data.createEntry({ description, start: start.toISOString(), stop: new Date(start.getTime() + 3_600_000).toISOString() });

  await login(page);
  await expect(page.locator('.entry-line').first().getByLabel('Description')).toHaveValue(description);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(EMAIL);
  const session = await sessionCookie(page, baseURL!);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // The server dropped the session itself, not only the browser's cookie.
  expect(await meWithSession(baseURL!, session)).toBe(403);
  expect((await page.context().cookies()).some((c) => c.name === 'tokkl_session')).toBe(false);

  const expectNoPrivateData = async () => {
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.locator('.entry-line')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(description);
    expect(html).not.toContain(EMAIL);
  };
  await expectNoPrivateData();
  await page.reload();
  await expectNoPrivateData();
  // History holds the settings page and the timer page from the logged-in visit.
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/settings`);
  await expectNoPrivateData();
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/`);
  await expectNoPrivateData();
});

// Wrong passwords count per account and address, so ten lock that account here while
// other emails from the same address still get the usual answer. Setup codes have their own count.
// An email that differs only in ASCII case is the same account and shares its count.
// Every 429 says when to retry; the account's window opened seconds ago, so nearly all of it is left.
test('ten wrong passwords lock the account on this address, and the login form says so', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  runtimeErrors.allowResponse({ status: 429, method: 'POST', path: /^\/api\/app\/login$/, reason: 'the account has ten failed logins from this address' });
  runtimeErrors.allowResponse({ status: 403, method: 'POST', path: /^\/api\/app\/login$/, reason: 'an unknown email still gets the usual answer' });
  const attempt = async (email: string, password: string) =>
    (await page.request.post(`${server.baseURL}/api/app/login`, { headers: CSRF, data: { email, password } })).status();

  // Failed logins before the account exists leave the setup code's attempts alone.
  for (let i = 0; i < 10; i++) expect(await attempt('nobody@auth.example', 'wrong password')).toBe(403);
  const { apiToken } = await createAccount(server.baseURL);
  for (let i = 0; i < 10; i++) expect(await attempt(ACCOUNT.email.toUpperCase(), 'wrong password')).toBe(403);
  const expectNearlyFullWindow = (response: { headers(): Record<string, string> }) =>
    expect(retryAfter(response)).toBeGreaterThan(LIMIT_WINDOW_SECONDS - 60);

  await page.goto(server.baseURL);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  const alert = page.getByRole('alert');
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password').fill(ACCOUNT.password);
  const formLocked = page.waitForResponse((r) => r.url() === `${server.baseURL}/api/app/login` && r.status() === 429);
  await page.getByRole('button', { name: 'Log in' }).click();
  expectNearlyFullWindow(await formLocked);
  await expect(alert).toHaveText('Too many failed login attempts, try again later');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect((await page.context().cookies(server.baseURL)).some((c) => c.name === 'tokkl_session')).toBe(false);
  const basicLocked = await page.request.get(`${server.baseURL}/api/v9/me`, {
    headers: { authorization: basic(ACCOUNT.email, ACCOUNT.password) },
  });
  expect(basicLocked.status()).toBe(429);
  expectNearlyFullWindow(basicLocked);
  // A password change checks the current password against the same counters, even over the API token.
  const changeLocked = await page.request.put(`${server.baseURL}/api/v9/me`, {
    headers: { authorization: basic(apiToken, 'api_token') },
    data: { current_password: ACCOUNT.password, password: 'second password 2' },
  });
  expect(changeLocked.status()).toBe(429);
  expectNearlyFullWindow(changeLocked);

  // Twenty failures from this address are far below its own limit, so another email is not refused.
  await page.getByLabel('Email').fill('someone@auth.example');
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(alert).toHaveText('Incorrect email or password');
});

// Login, setup and invite acceptance refuse a request without X-Tokkl-CSRF before doing
// anything else: 403, no cookie, nothing charged to a limiter, and the invite stays usable.
test('login, setup and invite acceptance without the CSRF header are refused and charge nothing', async ({ servers }) => {
  const server = await servers.start({ slot: 0 });
  const api = await request.newContext({ baseURL: server.baseURL });
  const refused = async (path: string, data: object) => {
    const response = await api.post(path, { data });
    expect(response.status(), path).toBe(403);
    expect(await response.json(), path).toBe('Missing CSRF header');
    expect(response.headers()['set-cookie'], path).toBeUndefined();
  };
  try {
    // More wrong codes than the setup limit allows, then the right one: none of them is counted.
    for (let i = 0; i < 11; i++) await refused('/api/app/setup', { setup_code: 'WRONG-CODE', ...ACCOUNT });
    await refused('/api/app/setup', { setup_code: SETUP_CODE, ...ACCOUNT });
    expect(await (await api.get('/api/app/status')).json()).toEqual({ setup_required: true });
    const { apiToken } = await createAccount(server.baseURL);

    for (let i = 0; i < 11; i++) await refused('/api/app/login', { email: ACCOUNT.email, password: 'wrong password' });
    await refused('/api/app/login', { email: ACCOUNT.email, password: ACCOUNT.password });
    const login = await api.post('/api/app/login', { headers: CSRF, data: { email: ACCOUNT.email, password: ACCOUNT.password } });
    expect(login.status()).toBe(200);

    const invite = await createInvite(server.baseURL, apiToken, 'user');
    const acceptPath = inviteApiPath(invite);
    await refused(acceptPath, { email: 'member@auth.example', password: 'member password 1' });
    expect(await (await api.get(acceptPath)).json()).toEqual({ role: 'user' });
    await acceptInvite(server.baseURL, invite, 'member@auth.example');
  } finally {
    await api.dispose();
  }
});

// A cross-site form can post a JSON-shaped text/plain body, which the server parses, but
// it cannot add the header, so it cannot sign the browser into the account it names.
test('a cross-site form that posts valid credentials does not sign the browser in', async ({ page, servers }) => {
  const server = await servers.start({ slot: 0 });
  await createAccount(server.baseURL);
  const loginURL = `${server.baseURL}/api/app/login`;
  const body = JSON.stringify({ email: ACCOUNT.email, password: ACCOUNT.password, pad: '' });

  // text/plain sends name=value, so the name carries the JSON up to the last value's opening quote.
  await page.setContent(`<form method="post" enctype="text/plain" action="${loginURL}">
    <input type="hidden" name='${body.slice(0, -2)}' value='"}'></form>`);
  const response = page.waitForResponse((r) => r.url() === loginURL);
  await page.locator('form').evaluate((form: HTMLFormElement) => form.submit());
  expect((await response).status()).toBe(403);
  expect((await page.context().cookies(server.baseURL)).some((c) => c.name === 'tokkl_session')).toBe(false);

  // The same text/plain body with the header logs in, so the header is what refused the form.
  const withHeader = await page.request.post(loginURL, {
    headers: { ...CSRF, 'content-type': 'text/plain' }, data: `${body.slice(0, -2)}="}\r\n`,
  });
  expect(withHeader.status()).toBe(200);
});

// The sidebar shows who is signed in above Log out, one line each, with the full value in title.
// Changing only the case of one's own email is not "already in use".
test('the sidebar names the signed-in user and follows profile changes', async ({ page, servers }) => {
  const server = await servers.start({ slot: 0 });
  await createAccount(server.baseURL);
  await logInThroughForm(page, server.baseURL);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const user = nav.locator('.signed-in');
  const name = user.locator('.signed-in-name');
  const email = user.locator('.signed-in-email');
  const expectShown = async (part: typeof name, text: string) => {
    await expect(part).toHaveText(text);
    await expect(part).toHaveAttribute('title', text);
  };

  await expectShown(name, ACCOUNT.fullname);
  await expectShown(email, ACCOUNT.email);
  await expect(user).toContainText('Signed in as');
  const userBox = (await user.boundingBox())!;
  const logoutBox = (await nav.getByRole('button', { name: 'Log out' }).boundingBox())!;
  expect(userBox.y + userBox.height).toBeLessThanOrEqual(logoutBox.y + 0.5);

  const longName = 'Auth Owner, whose full name is far too long for the sidebar to show on one line';
  const recased = 'Owner@Auth.Example';
  await page.getByRole('link', { name: 'Settings' }).click();
  const profile = page.locator('#profile');
  await profile.getByLabel('Full name').fill(longName);
  await profile.getByLabel('Email').fill(recased);
  await profile.getByRole('button', { name: 'Save' }).click();
  await expectShown(name, longName);
  await expectShown(email, recased);
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
  const navBox = (await nav.boundingBox())!;
  const longBox = (await user.boundingBox())!;
  expect(longBox.x + longBox.width).toBeLessThanOrEqual(navBox.x + navBox.width + 0.5);

  // With no full name, the email stands alone.
  await profile.getByLabel('Full name').fill('');
  await profile.getByRole('button', { name: 'Save' }).click();
  await expect(name).toHaveCount(0);
  await expectShown(email, recased);
  expect(await (await page.request.get(`${server.baseURL}/api/v9/me`)).json()).toMatchObject({ fullname: '', email: recased });
});

// On a phone the setup and login cards, their fields, buttons and error fit the screen
// without sideways scrolling, in light and dark.
test.describe('on a phone', () => {
  test.use(PHONE);

  const expectCardFits = async (page: Page, labels: string[], button: string) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
      await expectFits(page.locator('.auth-card'));
      for (const label of labels) await expectFits(page.getByLabel(label));
      await expectFits(page.getByRole('button', { name: button }));
      await expectNoPageOverflow(page);
    }
  };

  test('the setup and login cards fit a phone in light and dark', async ({ page, runtimeErrors, servers }) => {
    const server = await servers.start({ slot: 0 });
    await page.goto(server.baseURL);
    await expect(page.getByRole('heading', { name: 'Create the first admin' })).toBeVisible();
    await expectCardFits(page, ['Setup code', 'Name', 'Email', 'Password'], 'Create admin account');

    runtimeErrors.allowResponse({ status: 403, method: 'POST', path: /^\/api\/app\/login$/, reason: 'a wrong password shows the login error' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Log in' }).click();
    const alert = page.locator('.auth-error').getByRole('alert');
    await expect(alert).toHaveText('Incorrect email or password');
    await expectCardFits(page, ['Email', 'Password'], 'Log in');
    await expectFits(page.locator('.auth-error'));
  });
});
