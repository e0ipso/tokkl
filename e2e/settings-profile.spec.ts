import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { loginAs } from './helpers.ts';

// The browser is in Europe/Madrid (playwright.config.ts); an API-set zone is stored canonically and matches it.

const CSRF = { 'X-Tokkl-CSRF': '1' };

async function setZoneThroughApi(page: Page, timezone: string): Promise<void> {
  expect((await page.request.put('/api/v9/me', { headers: CSRF, data: { timezone } })).status()).toBe(200);
}

test('a timezone set through the API in another case shows under its canonical name in the profile', async ({
  page,
  users,
}) => {
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

// Chromium and Node use the older tz names (Asia/Calcutta), Firefox the current ones; this gives Chromium
// Firefox's names, so the browser and the stored name are two names for one zone.
const FIREFOX_ZONE_NAMES = { 'Asia/Calcutta': 'Asia/Kolkata', 'Europe/Kiev': 'Europe/Kyiv' };

for (const [stored, browser] of Object.entries(FIREFOX_ZONE_NAMES)) {
  test.describe(`a browser that resolves its zone to ${browser}`, () => {
    test.use({ timezoneId: browser });

    test(`does not show the zone notice for an account stored as ${stored}`, async ({ page, users }) => {
      await page.addInitScript(
        names => {
          const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
          Intl.DateTimeFormat.prototype.resolvedOptions = function (this: Intl.DateTimeFormat) {
            const options = resolvedOptions.call(this);
            return { ...options, timeZone: names[options.timeZone] ?? options.timeZone };
          };
        },
        FIREFOX_ZONE_NAMES as Record<string, string>,
      );
      const user = await users.create();
      await loginAs(page, user.account);
      await setZoneThroughApi(page, browser);
      await page.goto('/settings');
      const profile = page.getByRole('form', { name: 'Profile' });
      await expect(profile.getByLabel('Timezone')).toHaveValue(stored);
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(browser);
      await expect(profile.getByRole('note')).toHaveCount(0);
    });
  });
}
