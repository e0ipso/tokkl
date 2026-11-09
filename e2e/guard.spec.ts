import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

// Canaries for the runtimeErrors fixture. Each one provokes a failure, checks that verify() rejects
// with it, then empties the list so the fixture's own verify() at teardown passes. Only these
// canaries may empty the list; other scenarios declare expected responses with allowResponse.

test('an error hidden by ErrorBoundary fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  // Every reply is decoded, so a malformed one fails its request instead of a render. An account
  // time zone is decoded as text, and the server only stores canonical zone names: one the browser
  // does not know makes date formatting throw while rendering.
  await page.route(/\/api\/v9\/me$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), timezone: 'Nowhere/Never' } });
  });
  await page.reload();
  // The error page is an alert with the page's h1 and a way back.
  const alert = page
    .getByRole('alert')
    .filter({ has: page.getByRole('heading', { level: 1, name: 'Something broke on this page' }) });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/console: RangeError: .*Nowhere\/Never/);
  runtimeErrors.issues.splice(0);
});

test('an uncaught page error fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  const uncaught = page.waitForEvent('pageerror');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('guard canary');
    }, 0);
  });
  await uncaught;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(/pageerror: Error: guard canary/);
  runtimeErrors.issues.splice(0);
});

test('a failed request fails the scenario even with a rule for another one', async ({
  page,
  runtimeErrors,
}, testInfo) => {
  runtimeErrors.allowResponse({
    status: 500,
    method: 'POST',
    path: /^\/api\/v9\/workspaces\/\d+\/projects$/,
    reason: 'canary: a rule that must not match the GET below',
  });
  await login(page);
  // Once only: the app retries 5xx responses, and the retry reaches the real server.
  await page.route(
    /\/api\/v9\/workspaces\/\d+\/projects\?/,
    route => route.fulfill({ status: 500, contentType: 'application/json', body: '"boom"' }),
    { times: 1 },
  );
  const failed = page.waitForResponse(
    response => /\/workspaces\/\d+\/projects\?/.test(response.url()) && response.status() === 500,
  );
  await page.reload();
  await failed;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(
    /response: 500 GET \S*\/api\/v9\/workspaces\/\d+\/projects/,
  );
  runtimeErrors.issues.splice(0);
});

/** Marks the canary's own request, so the app's requests to the same path (it polls /api/app/status) pass. */
const CANARY_HEADER = 'x-guard-canary';

/** Sends a request from the page that `page.route` fails with `error`, and waits until it has failed. */
async function failFromPage(page: Page, method: 'GET' | 'POST', path: string, error: 'aborted' | 'connectionrefused') {
  const isCanary = (request: { method(): string; headers(): Record<string, string> }) =>
    request.method() === method && CANARY_HEADER in request.headers();
  const handler = (route: Route) => (isCanary(route.request()) ? route.abort(error) : route.fallback());
  await page.route(path, handler);
  const failed = page.waitForEvent(
    'requestfailed',
    request => new URL(request.url()).pathname === path && isCanary(request),
  );
  await page.evaluate(
    ({ method, path, header }) =>
      fetch(path, {
        method,
        headers: { 'X-Tokkl-CSRF': '1', 'Content-Type': 'application/json', [header]: '1' },
        body: method === 'GET' ? undefined : '{}',
      }).catch(() => null),
    { method, path, header: CANARY_HEADER },
  );
  await failed;
  await page.unroute(path, handler);
}

test('a cancelled read passes, but an aborted write fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  await failFromPage(page, 'GET', '/api/app/status', 'aborted');
  await runtimeErrors.verify(testInfo);
  // A report query is a POST that only reads, and the app cancels one the filters replaced.
  await failFromPage(page, 'POST', '/api/app/report', 'aborted');
  await failFromPage(page, 'POST', '/api/app/report/entries', 'aborted');
  await runtimeErrors.verify(testInfo);

  await failFromPage(page, 'POST', '/api/v9/me/preferences', 'aborted');
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(
    /requestfailed: POST \S*\/api\/v9\/me\/preferences: net::ERR_ABORTED/,
  );
  runtimeErrors.issues.splice(0);
});

test('a read that fails for any reason but a cancel fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  await failFromPage(page, 'GET', '/api/app/status', 'connectionrefused');
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(
    /requestfailed: GET \S*\/api\/app\/status: net::ERR_CONNECTION_REFUSED/,
  );
  runtimeErrors.issues.splice(0);
});

test('a 403 sent with a session cookie fails the scenario', async ({ page, runtimeErrors }, testInfo) => {
  await login(page);
  await page.route(
    /\/api\/v9\/workspaces\/\d+\/projects\?/,
    route => route.fulfill({ status: 403, contentType: 'application/json', body: '"Forbidden"' }),
    { times: 1 },
  );
  const failed = page.waitForResponse(
    response => /\/workspaces\/\d+\/projects\?/.test(response.url()) && response.status() === 403,
  );
  await page.reload();
  await failed;
  await expect(runtimeErrors.verify(testInfo)).rejects.toThrow(
    /response: 403 GET \S*\/api\/v9\/workspaces\/\d+\/projects/,
  );
  runtimeErrors.issues.splice(0);
});
