import { request } from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';
import {
  ACCOUNT, basic, createAccount, days, expect, logInThroughForm, meWithBasic, meWithSession, sessionCookie, test,
} from './auth-tests-helpers.ts';

// TT-0029: password changes revoke other sessions, and session cookies expire. Each scenario runs
// its own disposable server, so the shared e2e account keeps its password.

const NEW_PASSWORD = 'second password 2';
const CSRF = { 'X-Timetrack-CSRF': '1' };

async function loginStatus(baseURL: string, password: string): Promise<number> {
  const api = await request.newContext({ baseURL });
  try {
    return (await api.post('/api/app/login', { data: { email: ACCOUNT.email, password } })).status();
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
  const api = await request.newContext({ baseURL: first.baseURL });
  let session: string;
  try {
    const login = await api.post('/api/app/login', { data: { email: ACCOUNT.email, password: ACCOUNT.password } });
    expect(login.status()).toBe(200);
    const cookie = (await api.storageState()).cookies.find((c) => c.name === 'tt_session')!;
    session = cookie.value;
    // The cookie carries the same 30-day lifetime the server enforces.
    expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(days(30) - 60_000);
    expect(cookie.expires * 1000 - Date.now()).toBeLessThanOrEqual(days(30));
  } finally {
    await api.dispose();
  }
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
