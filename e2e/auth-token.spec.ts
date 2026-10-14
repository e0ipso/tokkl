import type { Page } from '@playwright/test';
import { basic, createAccount, expect, logInThroughForm, test } from './auth-tests-helpers.ts';

// TT-0047: API token reveal, copy and reset through account settings. Each scenario runs its own
// disposable server, so the shared e2e account keeps its token.

async function openTokenCard(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  return page.locator('#api-token');
}

/** GET /api/v9/me from the page with only a Basic token, no cookie, so the runtime guard sees it. */
async function meStatusWithToken(page: Page, token: string): Promise<number> {
  const authorization = basic(token, 'api_token');
  return page.evaluate(async (header) => (await fetch('/api/v9/me', { headers: { authorization: header }, credentials: 'omit' })).status, authorization);
}

test('the API token starts hidden, can be shown, and copies to the clipboard', async ({ page, servers }) => {
  const server = await servers.start({ slot: 4 });
  const { apiToken } = await createAccount(server.baseURL);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.baseURL });
  await logInThroughForm(page, server.baseURL);
  const card = await openTokenCard(page);

  await expect(card.getByLabel('API token, hidden')).toHaveText('•'.repeat(32));
  expect(await page.content()).not.toContain(apiToken);

  await card.getByRole('button', { name: 'Show' }).click();
  await expect(card.getByLabel('API token', { exact: true })).toHaveText(apiToken);
  await card.getByRole('button', { name: 'Hide' }).click();
  await expect(card.getByLabel('API token, hidden')).toHaveText('•'.repeat(32));

  // Copy works while the token is hidden.
  await card.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status')).toContainText('API token copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(apiToken);
});

test('without the Clipboard API, a failed copy says how to copy by hand', async ({ page, servers }) => {
  const server = await servers.start({ slot: 4 });
  await createAccount(server.baseURL);
  // A plain-HTTP LAN address has no navigator.clipboard, and the textarea fallback can fail.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = () => false;
  });
  await logInThroughForm(page, server.baseURL);
  const card = await openTokenCard(page);

  await card.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status')).toContainText('Could not copy. Show the token and copy it by hand.');
});

test.fixme('TT-0057: a refused Clipboard API write shows the raw browser error instead of the copy-by-hand hint', async ({ page, servers }) => {
  const server = await servers.start({ slot: 4 });
  await createAccount(server.baseURL);
  // A secure page can still be refused, for example when the user blocked clipboard access.
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
  });
  await logInThroughForm(page, server.baseURL);
  const card = await openTokenCard(page);

  await card.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status')).toContainText('copy it by hand');
});

test('resetting the token asks first; confirming swaps tokens and keeps the browser logged in', async ({ page, runtimeErrors, servers }) => {
  const server = await servers.start({ slot: 4 });
  const { apiToken: oldToken } = await createAccount(server.baseURL);
  await logInThroughForm(page, server.baseURL);
  const card = await openTokenCard(page);
  await card.getByRole('button', { name: 'Show' }).click();
  const shown = card.getByLabel('API token', { exact: true });
  await expect(shown).toHaveText(oldToken);

  const dialog = page.getByRole('dialog', { name: 'Reset the API token?' });
  await card.getByRole('button', { name: 'Reset token' }).click();
  await expect(dialog).toContainText('The current token stops working right away.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(shown).toHaveText(oldToken);
  expect(await meStatusWithToken(page, oldToken)).toBe(200);
  expect((await (await page.request.get(`${server.baseURL}/api/v9/me`)).json()).api_token).toBe(oldToken);

  await card.getByRole('button', { name: 'Reset token' }).click();
  await dialog.getByRole('button', { name: 'Reset token' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('New API token created. Update the tools that use it.');
  await expect(shown).not.toHaveText(oldToken);
  const newToken = (await shown.textContent())!;
  expect(newToken).toMatch(/^[0-9a-f]{32}$/);

  runtimeErrors.allowResponse({ status: 403, method: 'GET', path: /^\/api\/v9\/me$/, reason: 'the old API token is used after the reset on purpose' });
  expect(await meStatusWithToken(page, oldToken)).toBe(403);
  expect(await meStatusWithToken(page, newToken)).toBe(200);

  // The browser session does not depend on the token.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const me = await page.request.get(`${server.baseURL}/api/v9/me`);
  expect(me.status()).toBe(200);
  expect((await me.json()).api_token).toBe(newToken);
});
