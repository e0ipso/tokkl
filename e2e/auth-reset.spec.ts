import {
  acceptInvite, createAccount, createInvite, createPasswordReset, expect, meWithSession, test,
} from './auth-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

// TT-0143: an admin's password reset link opens /reset/:token, where a logged-out person sets a
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

test('a bad reset link says so and offers the login page', async ({ page, runtimeErrors, servers }) => {
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
