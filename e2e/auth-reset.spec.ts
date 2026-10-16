import { request } from '@playwright/test';
import {
  CSRF, acceptInvite, createAccount, createInvite, createPasswordReset, expect, meWithSession, resetApiPath, test,
} from './auth-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

// An admin's password reset link opens /reset/:token, where a logged-out person sets a
// new password and then logs in with it. The page fits a phone.

test.use(PHONE);

const RESET_PATH = /^\/api\/app\/password-resets\/[^/]+$/;

test('a reset link sets a new password, ends old sessions, and the new password logs in', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const account = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'user'), 'forgetful@auth.example');
  const link = await createPasswordReset(server.baseURL, apiToken, account.email);

  await page.goto(`${server.baseURL}${link}`);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await expect(page.locator('.auth-card')).toContainText(account.email);
  const password = page.getByLabel('New password');
  const submit = page.getByRole('button', { name: 'Set password' });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const control of [page.locator('.auth-card'), password, submit]) await expectFits(control);
    await expectNoPageOverflow(page);
  }

  await password.fill('my new password 1');
  await submit.tap();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  expect(await meWithSession(server.baseURL, account.session), 'the session from before the reset ends').toBe(403);
  const toLogin = page.getByRole('link', { name: 'Go to log in' });
  await expectFits(toLogin);
  await expectNoPageOverflow(page);
  await toLogin.tap();

  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill('my new password 1');
  await page.getByRole('button', { name: 'Log in' }).tap();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  const me = await page.request.get(`${server.baseURL}/api/v9/me`);
  expect(await me.json()).toMatchObject({ email: account.email });

  // The link is spent: opening it again shows the error instead of the form.
  runtimeErrors.allowResponse({ status: 404, method: 'GET', path: RESET_PATH, reason: 'a used reset link' });
  await page.goto(`${server.baseURL}${link}`);
  await expect(page.getByRole('heading', { name: 'Reset link not valid' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Ask your admin for a new one');
  await expect(page.getByLabel('New password')).toHaveCount(0);
});

// The server's password rules show on the password field, which gets focus, like the
// other password forms.
test('a password the server rejects shows its error on the password field', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const account = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'user'), 'rules@auth.example');
  const link = await createPasswordReset(server.baseURL, apiToken, account.email);
  runtimeErrors.allowResponse({ status: 400, method: 'POST', path: RESET_PATH, reason: 'passwords that are too short and too long' });

  await page.goto(`${server.baseURL}${link}`);
  const password = page.getByLabel('New password');
  const submit = page.getByRole('button', { name: 'Set password' });
  // The input's own minimum would stop a short password before the server sees it.
  await password.evaluate((input) => input.removeAttribute('minlength'));
  for (const [value, message] of [
    ['short', 'Password must be at least 8 characters'],
    ['x'.repeat(1025), 'Password must be at most 1024 characters'],
  ] as const) {
    await password.fill(value);
    await submit.tap();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(password).toHaveAccessibleDescription(message);
    await expect(password).toBeFocused();
    await expect(page.locator('.auth-error')).toHaveCount(0);
  }

  // Typing clears the error, and a valid password still goes through.
  await password.fill('long enough now');
  await expect(password).not.toHaveAttribute('aria-invalid');
  await submit.tap();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
});

// A link spent after the form loaded gets the same 404 as any bad link. That
// is about the link, not the password, so it shows under the form and the field stays valid.
test('a link used elsewhere while the form is open shows the 404 under the form', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const account = await acceptInvite(server.baseURL, await createInvite(server.baseURL, apiToken, 'user'), 'twice@auth.example');
  const link = await createPasswordReset(server.baseURL, apiToken, account.email);

  await page.goto(`${server.baseURL}${link}`);
  const password = page.getByLabel('New password');
  await expect(password).toBeVisible();
  const elsewhere = await request.newContext({ baseURL: server.baseURL });
  try {
    expect((await elsewhere.post(resetApiPath(link), {
      headers: CSRF, data: { password: 'spent elsewhere 1' },
    })).status()).toBe(200);
  } finally {
    await elsewhere.dispose();
  }

  runtimeErrors.allowResponse({ status: 404, method: 'POST', path: RESET_PATH, reason: 'the link was used in another browser' });
  await password.fill('my new password 1');
  await page.getByRole('button', { name: 'Set password' }).tap();
  await expect(page.locator('.auth-error')).toHaveText('This password reset link is not valid. Ask your admin for a new one.');
  await expectFits(page.locator('.auth-error'));
  await expect(password).not.toHaveAttribute('aria-invalid');
  await expect(page.getByRole('heading', { name: 'Password changed' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set password' })).toBeEnabled();
});

test('a bad reset link says so and offers the login page',async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  await createAccount(server.baseURL);
  runtimeErrors.allowResponse({ status: 404, method: 'GET', path: RESET_PATH, reason: 'an unknown reset token' });

  await page.goto(`${server.baseURL}/reset/not-a-real-token`);
  await expect(page.getByRole('heading', { name: 'Reset link not valid' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expectNoPageOverflow(page);

  const login = page.getByRole('link', { name: 'Go to log in' });
  await expectFits(login);
  await login.tap();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
