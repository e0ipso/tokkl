import { request } from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';
import {
  ACCOUNT, CSRF, basic, createAccount, createInvite, days, expect, inviteApiPath, logInThroughForm, meWithBasic,
  meWithSession, sessionCookie, test, withAuth,
} from './auth-tests-helpers.ts';

// Password changes revoke other sessions, and session cookies expire. Each scenario runs
// its own disposable server, so the shared e2e account keeps its password.

const NEW_PASSWORD = 'second password 2';

/** Logs in over the API and returns the session cookie and how long until it expires. */
async function logIn(baseURL: string): Promise<{ session: string; expiresInMs: number }> {
  const api = await request.newContext({ baseURL });
  try {
    const login = await api.post('/api/app/login', { headers: CSRF, data: { email: ACCOUNT.email, password: ACCOUNT.password } });
    expect(login.status()).toBe(200);
    const cookie = (await api.storageState()).cookies.find((c) => c.name === 'tokkl_session')!;
    return { session: cookie.value, expiresInMs: cookie.expires * 1000 - Date.now() };
  } finally {
    await api.dispose();
  }
}

async function loginStatus(baseURL: string, password: string): Promise<number> {
  const api = await request.newContext({ baseURL });
  try {
    return (await api.post('/api/app/login', { headers: CSRF, data: { email: ACCOUNT.email, password } })).status();
  } finally {
    await api.dispose();
  }
}

test('changing the password keeps this browser logged in and logs the other one out', async ({ page, browser, servers }, testInfo) => {
  const server = await servers.start({ slot: 1 });
  const { apiToken } = await createAccount(server.baseURL);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const otherErrors = new RuntimeErrors(other);
  otherErrors.allowResponse({
    status: 403, method: 'GET', path: /^\/api\/v9\/me(\/|$)/,
    reason: 'the other browser still sends its session cookie after the password change revoked it',
  });
  try {
    await logInThroughForm(page, server.baseURL);
    await logInThroughForm(other, server.baseURL);
    const otherSession = await sessionCookie(other, server.baseURL);
    expect(await meWithSession(server.baseURL, otherSession)).toBe(200);

    await page.getByRole('link', { name: 'Settings' }).click();
    const card = page.locator('#password');
    await card.getByLabel('Current password').fill(ACCOUNT.password);
    await card.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await card.getByLabel('Repeat new password').fill(NEW_PASSWORD);
    await card.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('status')).toContainText('Password changed. Other browsers were logged out.');

    // This browser keeps its session for reads, writes and a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect((await page.request.get(`${server.baseURL}/api/v9/me`)).status()).toBe(200);
    const workspaceId = (await (await page.request.get(`${server.baseURL}/api/v9/me`)).json()).default_workspace_id;
    const entry = { start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z', description: 'After the change', created_with: 'e2e' };
    const write = await page.request.post(`${server.baseURL}/api/v9/workspaces/${workspaceId}/time_entries`, { headers: CSRF, data: entry });
    expect(write.status()).toBe(200);

    // The other browser's reads and writes fail, and a refresh lands on the login form.
    expect((await otherContext.request.get(`${server.baseURL}/api/v9/me`)).status()).toBe(403);
    const otherWrite = await otherContext.request.post(`${server.baseURL}/api/v9/workspaces/${workspaceId}/time_entries`, {
      headers: CSRF, data: { ...entry, description: 'From the revoked browser' },
    });
    expect(otherWrite.status()).toBe(403);
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Log in' })).toBeVisible();

    expect(await loginStatus(server.baseURL, ACCOUNT.password)).toBe(403);
    expect(await loginStatus(server.baseURL, NEW_PASSWORD)).toBe(200);
    // API tokens are not tied to the password: the same token keeps working.
    expect(await meWithBasic(server.baseURL, basic(apiToken, 'api_token'))).toBe(200);
    expect((await (await page.request.get(`${server.baseURL}/api/v9/me`)).json()).api_token).toBe(apiToken);
  } finally {
    await otherErrors.verify(testInfo);
    await otherContext.close();
  }
});

test('a password change over Basic auth revokes every cookie session', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 2 });
  const { apiToken } = await createAccount(server.baseURL);
  await logInThroughForm(page, server.baseURL);
  const session = await sessionCookie(page, server.baseURL);

  runtimeErrors.allowResponse({
    status: 403, method: 'GET', path: /^\/api\/v9\/me(\/|$)/,
    reason: 'the browser still sends the session cookie the Basic password change revoked',
  });

  const basicApi = await request.newContext({
    baseURL: server.baseURL, extraHTTPHeaders: { authorization: basic(ACCOUNT.email, ACCOUNT.password) },
  });
  try {
    const change = await basicApi.put('/api/v9/me', { data: { current_password: ACCOUNT.password, password: NEW_PASSWORD } });
    expect(change.status()).toBe(200);
  } finally {
    await basicApi.dispose();
  }

  expect(await meWithSession(server.baseURL, session)).toBe(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  expect(await meWithBasic(server.baseURL, basic(ACCOUNT.email, ACCOUNT.password))).toBe(403);
  expect(await meWithBasic(server.baseURL, basic(ACCOUNT.email, NEW_PASSWORD))).toBe(200);
  expect(await meWithBasic(server.baseURL, basic(apiToken, 'api_token'))).toBe(200);
});

test('a session cookie stops working after the 30-day lifetime', async ({ servers }) => {
  const first = await servers.start({ slot: 3 });
  const { apiToken } = await createAccount(first.baseURL);
  const { session, expiresInMs } = await logIn(first.baseURL);
  // The cookie carries the same 30-day lifetime the server enforces.
  expect(expiresInMs).toBeGreaterThan(days(30) - 60_000);
  expect(expiresInMs).toBeLessThanOrEqual(days(30));
  expect(await meWithSession(first.baseURL, session)).toBe(200);
  await first.stop();

  // Restart the same data with only the server's Date moved forward.
  const almost = await servers.start({ slot: 3, dataDir: first.dataDir, clockShiftMs: days(30) - 3_600_000 });
  expect(await meWithSession(almost.baseURL, session)).toBe(200);
  await almost.stop();

  const expired = await servers.start({ slot: 3, dataDir: first.dataDir, clockShiftMs: days(30) + 60_000 });
  expect(await meWithSession(expired.baseURL, session)).toBe(403);
  // Expiry applies to sessions only; the API token and a fresh login still work.
  expect(await meWithBasic(expired.baseURL, basic(apiToken, 'api_token'))).toBe(200);
  expect(await loginStatus(expired.baseURL, ACCOUNT.password)).toBe(200);
});

// An admin's session_days and invite_days apply to sessions and invites created after the
// change. They are stored with the data, so a restart keeps them; earlier sessions keep their expiry.
test('stored session and invite lifetimes apply to new sessions and invites, across a restart', async ({ servers }) => {
  const first = await servers.start({ slot: 3 });
  const { apiToken } = await createAccount(first.baseURL);
  const admin = basic(apiToken, 'api_token');
  const before = await logIn(first.baseURL);

  await withAuth(first.baseURL, admin, async (api) => {
    expect(await (await api.get('/api/app/admin/settings')).json()).toEqual({ session_days: 30, invite_days: 7 });
    for (const change of [{ session_days: 366 }, { invite_days: 91 }]) {
      expect((await api.put('/api/app/admin/settings', { data: change })).status(), JSON.stringify(change)).toBe(400);
    }
    const put = await api.put('/api/app/admin/settings', { data: { session_days: 2, invite_days: 1 } });
    expect(put.status()).toBe(200);
    expect(await put.json()).toEqual({ session_days: 2, invite_days: 1 });
  });

  const after = await logIn(first.baseURL);
  expect(after.expiresInMs).toBeGreaterThan(days(2) - 60_000);
  expect(after.expiresInMs).toBeLessThanOrEqual(days(2));
  const invite = await createInvite(first.baseURL, apiToken, 'user');
  const inviteLookup = inviteApiPath(invite);
  await withAuth(first.baseURL, admin, async (api) => {
    const [pending] = await (await api.get('/api/app/admin/invites')).json() as Array<{ expires_at: string }>;
    const expiresInMs = Date.parse(pending!.expires_at) - Date.now();
    expect(expiresInMs).toBeGreaterThan(days(1) - 60_000);
    expect(expiresInMs).toBeLessThanOrEqual(days(1));
  });
  await first.stop();

  // Restart the same data two days later, by the server's clock.
  const later = await servers.start({ slot: 3, dataDir: first.dataDir, clockShiftMs: days(2) + 60_000 });
  await withAuth(later.baseURL, admin, async (api) => {
    expect(await (await api.get('/api/app/admin/settings')).json()).toEqual({ session_days: 2, invite_days: 1 });
    expect(await (await api.get('/api/app/admin/invites')).json()).toEqual([]);
    expect((await api.get(inviteLookup)).status()).toBe(404);
  });
  expect(await meWithSession(later.baseURL, after.session)).toBe(403);
  expect(await meWithSession(later.baseURL, before.session)).toBe(200);
});
