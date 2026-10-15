import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

// Canaries for the runtimeErrors fixture. Each one provokes a failure, checks that verify() rejects
// with it, then empties the list so the fixture's own verify() at teardown passes. Only these
// canaries may empty the list; other scenarios declare expected responses with allowResponse.

test('an error hidden by ErrorBoundary fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  // A malformed favorites preference makes the timer page throw while rendering.
  await page.route('**/api/v9/me/preferences', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorites: 5 }) })
    : route.continue()));
  await page.reload();
  // TT-0088: the error page is an alert with the page's h1 and a way back.
  const alert = page.getByRole('alert').filter({ has: page.getByRole('heading', { level: 1, name: 'Something broke on this page' }) });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/console: TypeError: .* is not a function/);
  runtimeErrors.issues.splice(0);
});

test('an uncaught page error fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  const uncaught = page.waitForEvent('pageerror');
  await page.evaluate(() => { setTimeout(() => { throw new Error('guard canary'); }, 0); });
  await uncaught;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/pageerror: Error: guard canary/);
  runtimeErrors.issues.splice(0);
});

test('a failed request fails the scenario even with a rule for another one', async ({ page, runtimeErrors }, testInfo) => {
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: /^\/api\/v9\/workspaces\/\d+\/projects$/, reason: 'canary: a rule that must not match the GET below' });
  await login(page);
  // Once only: the app retries 5xx responses, and the retry reaches the real server.
  await page.route(/\/api\/v9\/workspaces\/\d+\/projects\?/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '"boom"' }), { times: 1 });
  const failed = page.waitForResponse((response) => /\/workspaces\/\d+\/projects\?/.test(response.url()) && response.status() === 500);
  await page.reload();
  await failed;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/response: 500 GET \S*\/api\/v9\/workspaces\/\d+\/projects/);
  runtimeErrors.issues.splice(0);
});

test('a 403 sent with a session cookie fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  await page.route(/\/api\/v9\/workspaces\/\d+\/projects\?/, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '"Forbidden"' }), { times: 1 });
  const failed = page.waitForResponse((response) => /\/workspaces\/\d+\/projects\?/.test(response.url()) && response.status() === 403);
  await page.reload();
  await failed;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/response: 403 GET \S*\/api\/v9\/workspaces\/\d+\/projects/);
  runtimeErrors.issues.splice(0);
});
