import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

for (const [surface, pagePath, downloadPath, buttonName, otherButton] of [
  ['account', '/settings/data', '/api/app/export.json', 'Export JSON', 'Export CSV'],
  [
    'report',
    '/reports?from=2026-06-01&to=2026-06-30',
    '/api/app/report/summary.csv',
    'CSV (summary)',
    'CSV (detailed)',
  ],
] as const) {
  test(`${surface} downloads can be cancelled, restore focus and allow another download`, async ({ page }) => {
    await login(page);
    await page.goto(pagePath);
    const start = page.getByRole('button', { name: buttonName, exact: true });
    await expect(start).toBeVisible();

    // Leave the response pending so Cancel can abort the request before any file is saved.
    await page.route(`**${downloadPath}`, () => {});
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === downloadPath);
    await start.click();
    await requested;
    await expect(start).toBeDisabled();
    await expect(page.getByRole('button', { name: otherButton, exact: true })).toBeDisabled();

    const failed = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === downloadPath);
    await page.getByRole('button', { name: 'Cancel download' }).click();
    expect((await failed).failure()?.errorText).toBe('net::ERR_ABORTED');
    await expect(start).toBeEnabled();
    await expect(start).toBeFocused();
    await expect(page.getByRole('button', { name: 'Cancel download' })).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);

    await page.unroute(`**${downloadPath}`);
    const downloaded = page.waitForEvent('download');
    await start.click();
    expect(await (await downloaded).failure()).toBeNull();
    await expect(start).toBeEnabled();
  });

  test(`leaving the ${surface} download view aborts its pending request without an error`, async ({ page }) => {
    await login(page);
    await page.goto(pagePath);
    await page.route(`**${downloadPath}`, () => {});
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === downloadPath);
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    await requested;

    const failed = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === downloadPath);
    await page.getByRole('link', { name: 'Timer', exact: true }).click();
    expect((await failed).failure()?.errorText).toBe('net::ERR_ABORTED');
    await expect(page.locator('.toast')).toHaveCount(0);
  });
}
