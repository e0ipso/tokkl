import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { loginAs } from './helpers.ts';

// Settings > Profile compares the account timezone with the browser's (Europe/Madrid in
// playwright.config.ts) and shows a notice when they differ. A zone set through the API in
// another case is stored under its canonical name, so it matches the browser's zone.

const CSRF = { 'X-Tokkl-CSRF': '1' };

async function setZoneThroughApi(page: Page, timezone: string): Promise<void> {
  expect((await page.request.put('/api/v9/me', { headers: CSRF, data: { timezone } })).status()).toBe(200);
}

test('a timezone set through the API in another case shows under its canonical name in the profile', async ({ page, users }) => {
  // The worker account's zone outlives the reset fixture, so this scenario changes its own account.
  const user = await users.create();
  await loginAs(page, user.account);
  const profile = page.getByRole('form', { name: 'Profile' });
  const notice = profile.getByRole('note');

  await setZoneThroughApi(page, 'asia/tokyo');
  await page.goto('/settings');
  await expect(profile.getByLabel('Timezone')).toHaveValue('Asia/Tokyo');
  await expect(notice).toContainText('This browser is set to Europe/Madrid, but the account uses Asia/Tokyo.');

  await setZoneThroughApi(page, 'EUROPE/MADRID');
  await page.reload();
  await expect(profile.getByLabel('Timezone')).toHaveValue('Europe/Madrid');
  await expect(notice).toHaveCount(0);
});
