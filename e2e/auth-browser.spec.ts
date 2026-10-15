import { EMAIL, PASSWORD } from './fixtures.ts';
import { login } from './helpers.ts';
import { ACCOUNT, SETUP_CODE, expect, meWithSession, sessionCookie, test } from './auth-tests-helpers.ts';

// TT-0028: failed setup and login in the browser, and what logout leaves behind.

test('a wrong setup code shows an error, and a retry with the right code creates the account', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  runtimeErrors.allowResponse({ status: 403, method: 'POST', path: /^\/api\/app\/setup$/, reason: 'the first attempt sends a wrong setup code' });

  await page.goto(server.baseURL);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Setup code').fill('WRONG-CODE');
  await page.getByLabel('Name').fill(ACCOUNT.fullname);
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password').fill(ACCOUNT.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toHaveText('Invalid setup code. It is printed in the server log on startup.');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  expect(await (await page.request.get(`${server.baseURL}/api/app/status`)).json()).toEqual({ setup_required: true });
  expect((await page.context().cookies(server.baseURL)).some((c) => c.name === 'tokkl_session')).toBe(false);

  // The form keeps what was typed, so only the code needs fixing.
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const me = await page.request.get(`${server.baseURL}/api/v9/me`);
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(ACCOUNT.email);
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
