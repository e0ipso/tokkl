import { request, type Locator, type Page } from '@playwright/test';
import { basic, createAccount, expect, test } from './auth-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

// TT-0138: an admin's invite link opens /invite/:token, where a logged-out person creates their
// account and lands on the timer. The page fits a phone and every control shows its focus ring.

test.use(PHONE);

/** Creates an invite as the server's admin, through the API, and returns its /invite/<token> path. */
async function createInvite(baseURL: string, apiToken: string, role: 'admin' | 'user'): Promise<string> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { authorization: basic(apiToken, 'api_token') } });
  try {
    const response = await api.post('/api/app/admin/invites', { data: { role } });
    expect(response.status()).toBe(200);
    const { url } = await response.json() as { url: string };
    expect(url).toMatch(/^\/invite\/[\w-]+$/);
    return url;
  } finally {
    await api.dispose();
  }
}

/** Presses Tab until the target has focus, so :focus-visible comes from keyboard use. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab did not reach the control');
}

test('an invited person creates an account in the browser and lands on the timer', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const invite = await createInvite(server.baseURL, apiToken, 'user');

  await page.goto(`${server.baseURL}${invite}`);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  const controls = [page.getByLabel('Name'), page.getByLabel('Email'), page.getByLabel('Password'),
    page.getByRole('button', { name: 'Create account' })];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectFits(page.locator('.auth-card'));
    for (const control of controls) await expectFits(control);
    await expectNoPageOverflow(page);
  }
  for (const control of controls) {
    await tabTo(page, control);
    const outline = await control.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline, 'a visible focus ring').toEqual({ width: '2px', style: 'solid' });
  }

  await page.getByLabel('Name').fill('Invited Person');
  await page.getByLabel('Email').fill('invited@auth.example');
  await page.getByLabel('Password').fill('invited password 1');
  await page.getByRole('button', { name: 'Create account' }).tap();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(page).toHaveURL(`${server.baseURL}/`);

  const me = await page.request.get(`${server.baseURL}/api/v9/me`);
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ email: 'invited@auth.example', fullname: 'Invited Person' });

  // The link is spent: opening it again shows the error instead of the form.
  runtimeErrors.allowResponse({ status: 404, method: 'GET', path: /^\/api\/app\/invites\/[^/]+$/, reason: 'a used invite token' });
  await page.goto(`${server.baseURL}${invite}`);
  await expect(page.getByRole('heading', { name: 'Invite link not valid' })).toBeVisible();
});

test('a bad invite link says so and offers the login page', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  await createAccount(server.baseURL);
  runtimeErrors.allowResponse({ status: 404, method: 'GET', path: /^\/api\/app\/invites\/[^/]+$/, reason: 'an unknown invite token' });

  await page.goto(`${server.baseURL}/invite/not-a-real-token`);
  await expect(page.getByRole('heading', { name: 'Invite link not valid' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Ask your admin for a new one');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expectNoPageOverflow(page);

  const login = page.getByRole('link', { name: 'Go to log in' });
  await expectFits(login);
  await login.tap();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
