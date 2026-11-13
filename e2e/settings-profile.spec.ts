import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { loginAs } from './helpers.ts';
import { PHONE, expectNoPageOverflow, tap } from './mobile-tests-helpers.ts';

// The browser is in Europe/Madrid (playwright.config.ts); an API-set zone is stored canonically and matches it.

const CSRF = { 'X-Tokkl-CSRF': '1' };

const SETTINGS_PAGES = [
  ['profile', 'Profile'],
  ['password', 'Password'],
  ['preferences', 'Preferences'],
  ['workspace', 'Workspace'],
  ['api-token', 'API token'],
  ['data', 'Data'],
  ['session', 'Session'],
] as const;

for (const [device, options] of [
  ['desktop', {}],
  ['phone', PHONE],
] as const) {
  test.describe(`settings navigation on ${device}`, () => {
    test.use(options);

    test('each section has its own URL and content, with reload and history support', async ({ page, users }) => {
      const user = await users.create();
      await loginAs(page, user.account);
      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings\/profile$/);
      const nav = page.getByRole('navigation', { name: 'Settings sections' });
      const cards = page.locator('.settings-card');

      for (const [id, label] of SETTINGS_PAGES) {
        const link = nav.getByRole('link', { name: label, exact: true });
        await expect(link).toHaveAttribute('href', `/settings/${id}`);
        if (device === 'phone') await tap(link);
        else await link.click();
        await expect(page).toHaveURL(new RegExp(`/settings/${id}$`));
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect(nav.locator('[aria-current]')).toHaveCount(1);
        await expect(cards).toHaveCount(1);
        await expect(cards).toHaveAttribute('id', id);
        await expect(cards.getByRole('heading', { level: 2, name: label, exact: true })).toBeVisible();
        await expect(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }),
        ).toHaveAttribute('aria-current', 'page');
        if (device === 'phone') await expectNoPageOverflow(page);
      }

      await page.reload();
      await expect(cards).toHaveAttribute('id', 'session');
      await page.goBack();
      await expect(page).toHaveURL(/\/settings\/data$/);
      await expect(cards).toHaveAttribute('id', 'data');
      await page.goForward();
      await expect(cards).toHaveAttribute('id', 'session');

      for (const [id] of SETTINGS_PAGES) {
        await page.goto(`/settings/${id}`);
        await expect(cards).toHaveCount(1);
        await expect(cards).toHaveAttribute('id', id);
      }
      await page.goto('/settings#preferences');
      await expect(page).toHaveURL(/\/settings\/preferences$/);
      await expect(cards).toHaveAttribute('id', 'preferences');
      await page.goto('/settings/unknown');
      await expect(page).toHaveURL(/\/settings\/profile$/);
    });
  });
}

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
