import { request, type Locator, type Page } from '@playwright/test';
import {
  ACCOUNT, CSRF, LIMIT_WINDOW_SECONDS, acceptInvite, basic, createAccount, createInvite, expect, inviteApiPath,
  meWithSession, retryAfter, test, withAuth,
} from './auth-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

// An admin's invite link opens /invite/:token, where a logged-out person creates their
// account and lands on the timer. The page fits a phone and every control shows its focus ring.

test.use(PHONE);

/** The one 404 body for unknown, used, expired and revoked invite tokens. */
const INVITE_NOT_VALID = 'This invite link is not valid. Ask your admin for a new one.';

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
  // The form sends the browser's zone (Europe/Madrid in playwright.config.ts) and the account keeps it.
  expect(await me.json()).toMatchObject({ email: 'invited@auth.example', fullname: 'Invited Person', timezone: 'Europe/Madrid' });

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

// Each invited account is a second, separate account: its own private workspace, the role
// the invite named, no access to the admin's data. Pending invites are listed and can be revoked.
test('an invite adds a separate account in its own workspace, and a revoked link stops working', async ({ servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const admin = basic(apiToken, 'api_token');
  const adminWorkspace = await withAuth(server.baseURL, admin, async (api) =>
    (await (await api.get('/api/v9/me')).json()).default_workspace_id as number);
  const userInvite = await createInvite(server.baseURL, apiToken, 'user');
  const adminInvite = await createInvite(server.baseURL, apiToken, 'admin');

  const invited = await acceptInvite(server.baseURL, userInvite, 'member@auth.example');
  expect(invited.workspaceId).not.toBe(adminWorkspace);
  expect(await meWithSession(server.baseURL, invited.session)).toBe(200);
  await withAuth(server.baseURL, basic(invited.apiToken, 'api_token'), async (api) => {
    expect((await api.get(`/api/v9/workspaces/${invited.workspaceId}`)).status()).toBe(200);
    expect((await api.get(`/api/v9/workspaces/${adminWorkspace}`)).status()).toBe(403);
    for (const path of ['/api/app/admin/users', '/api/app/admin/invites', '/api/app/admin/settings']) {
      expect((await api.get(path)).status(), path).toBe(403);
    }
  });

  await withAuth(server.baseURL, admin, async (api) => {
    expect((await api.get(`/api/v9/workspaces/${invited.workspaceId}`)).status()).toBe(403);
    const accounts = await (await api.get('/api/app/admin/users')).json() as Array<{ email: string; role: string }>;
    expect(accounts.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: ACCOUNT.email, role: 'admin' }, { email: invited.email, role: 'user' },
    ]);

    // Only the unused admin invite is pending; revoking it kills its link with the usual 404.
    const pending = await (await api.get('/api/app/admin/invites')).json() as Array<{ id: number; role: string }>;
    expect(pending.map(({ role }) => role)).toEqual(['admin']);
    expect((await api.delete(`/api/app/admin/invites/${pending[0]!.id}`)).status()).toBe(200);
    expect(await (await api.get('/api/app/admin/invites')).json()).toEqual([]);
    expect((await api.delete(`/api/app/admin/invites/${pending[0]!.id}`)).status()).toBe(404);
  });

  const anonymous = await request.newContext({ baseURL: server.baseURL });
  try {
    for (const link of [adminInvite, userInvite, '/invite/not-a-real-token']) {
      const lookup = await anonymous.get(inviteApiPath(link));
      expect(lookup.status(), link).toBe(404);
      expect(await lookup.json(), link).toBe(INVITE_NOT_VALID);
    }
  } finally {
    await anonymous.dispose();
  }
});

// Wrong tokens charge the per-address counter that password checks share, so a hundred
// misses lock this address out of invite links and the login form alike.
test('a hundred wrong invite tokens lock this address out of invites and logins', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 0 });
  const { apiToken } = await createAccount(server.baseURL);
  const invite = await createInvite(server.baseURL, apiToken, 'user');
  runtimeErrors.allowResponse({ status: 429, method: 'GET', path: /^\/api\/app\/invites\/[^/]+$/, reason: 'this address guessed a hundred invite tokens' });

  const anonymous = await request.newContext({ baseURL: server.baseURL });
  try {
    for (let i = 0; i < 100; i++) expect((await anonymous.get(`/api/app/invites/guess-${i}`)).status()).toBe(404);
    const blocked = await anonymous.get('/api/app/invites/guess-100');
    expect(blocked.status()).toBe(429);
    expect(retryAfter(blocked)).toBeGreaterThan(LIMIT_WINDOW_SECONDS - 60);
    // The real link is refused too, before any lookup.
    expect((await anonymous.get(inviteApiPath(invite))).status()).toBe(429);
    const login = await anonymous.post('/api/app/login', { headers: CSRF, data: { email: ACCOUNT.email, password: ACCOUNT.password } });
    expect(login.status()).toBe(429);
    retryAfter(login);
  } finally {
    await anonymous.dispose();
  }

  // The browser shares the address, so the invite page cannot load the invite either.
  await page.goto(`${server.baseURL}${invite}`);
  await expect(page.getByRole('alert')).toContainText('Too many failed attempts');
  await expect(page.getByLabel('Password')).toHaveCount(0);
});
