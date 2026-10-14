import { request, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

// TT-0073: the theme saved on the server is cached in the browser and applied before React
// mounts, so a dark choice on a light system never flashes the light UI on reload.

const CSRF = { 'X-Timetrack-CSRF': '1' };
const CACHE_KEY = 'timetrack.theme';

type Theme = 'system' | 'light' | 'dark';

async function saveTheme(page: Page, theme: Theme) {
  const response = await page.request.post('/api/v9/me/preferences', { headers: CSRF, data: { theme } });
  expect(response.ok()).toBe(true);
}

const dataTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const cachedTheme = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), CACHE_KEY);

/** Reloads and reads data-theme at DOMContentLoaded, before any API response can arrive. */
async function themeAtFirstParse(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  return dataTheme(page);
}

test.use({ colorScheme: 'light' });

// The shared fixture does not reset the theme, so put the account back on the default.
test.afterEach(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  try {
    expect((await api.post('/api/app/login', { data: { email: EMAIL, password: PASSWORD } })).ok()).toBe(true);
    expect((await api.post('/api/v9/me/preferences', { headers: CSRF, data: { theme: 'system' } })).ok()).toBe(true);
    await api.post('/api/app/logout', { headers: CSRF });
  } finally {
    await api.dispose();
  }
});

test('a cached dark theme is on <html> when the document is parsed, on a light system', async ({ page }) => {
  await login(page);
  expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
  await saveTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');

  // Hold the preferences response so only the cache can have set the attribute.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v9/me/preferences', async (route) => {
    await held;
    await route.continue();
  });
  expect(await themeAtFirstParse(page)).toBe('dark');
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  expect(await dataTheme(page)).toBe('dark');
  const answered = page.waitForResponse('**/api/v9/me/preferences');
  release();
  await answered;
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the server preference replaces a stale cache, and with nothing cached the system decides', async ({ page }) => {
  await login(page);
  await saveTheme(page, 'light');
  await page.evaluate((key) => window.localStorage.setItem(key, 'dark'), CACHE_KEY);

  // The stale cache applies first, then the server's light theme replaces it.
  expect(await themeAtFirstParse(page)).toBe('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await cachedTheme(page)).toBe('light');

  // Back on "Match the system", the server answer drops both the attribute and the cache.
  await saveTheme(page, 'system');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await cachedTheme(page)).toBeNull();
  expect(await themeAtFirstParse(page)).toBeNull();
});

test('both log out buttons clear the cached theme', async ({ page }) => {
  await login(page);
  await saveTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await cachedTheme(page)).toBeNull();
  expect(await themeAtFirstParse(page)).toBeNull();

  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('region', { name: 'Session' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await cachedTheme(page)).toBeNull();
  expect(await themeAtFirstParse(page)).toBeNull();
});
