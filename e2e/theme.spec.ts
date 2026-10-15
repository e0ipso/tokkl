import { request, type Browser, type Locator, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

// TT-0073: the theme saved on the server is cached in the browser and applied before React
// mounts, so a dark choice on a light system never flashes the light UI on reload.
// TT-0098: a blocking script in the head applies that cache, so it holds even when the bundle is slow.
// TT-0075: the theme picked in Settings decides the page and chart colours.

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

interface FirstFrame {
  theme: string | null;
  background: string;
  rendered: boolean;
}

test('a cached dark theme is on the first frame while the bundle is still downloading', async ({ page, browser, baseURL }) => {
  const colours = await systemTokenColours(browser, baseURL!);
  await login(page);
  await saveTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');

  // Records <html> on the first animation frame of the next load. `rendered` tells whether React
  // had already put anything in #root, which would mean the bundle beat the frame.
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      const html = document.documentElement;
      const frame: FirstFrame = {
        theme: html.getAttribute('data-theme'),
        background: getComputedStyle(html).backgroundColor,
        rendered: Boolean(document.getElementById('root')?.hasChildNodes()),
      };
      (window as unknown as { firstFrame: FirstFrame }).firstFrame = frame;
    });
  });
  // A cold cache or a fresh deploy: the module bundle arrives well after the HTML and CSS.
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  const first = await page.evaluate(() => (window as unknown as { firstFrame?: FirstFrame }).firstFrame);
  expect(first).toEqual({ theme: 'dark', background: colours.dark['--bg'], rendered: false });
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

// The tokens are light-dark(light, dark) in source, but the production build compiles that into
// variables switched on <html>, so a nested color-scheme does not flip them. The reference values
// therefore come from the logged-out page in a fresh context per emulated scheme: no data-theme
// there, so only the media query decides. No hex is written here.
type Scheme = 'light' | 'dark';
type Token = '--bg' | '--chart-billable';
type TokenColours = Record<Scheme, Record<Token, string>>;

const TOKENS: Token[] = ['--bg', '--chart-billable'];

async function systemTokenColours(browser: Browser, baseURL: string): Promise<TokenColours> {
  const colours = {} as TokenColours;
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ baseURL, colorScheme: scheme });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
      colours[scheme] = await page.evaluate((tokens) => Object.fromEntries(tokens.map((token) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${token})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [token, colour];
      })), TOKENS) as Record<Token, string>;
    } finally {
      await context.close();
    }
  }
  for (const token of TOKENS) {
    expect(colours.light[token], `${token} must differ between schemes for these checks to mean anything`)
      .not.toBe(colours.dark[token]);
  }
  return colours;
}

/** The page background. styles.css paints it on <html>; <body> stays transparent. */
const pageBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const fill = (mark: Locator) => mark.evaluate((element) => getComputedStyle(element).fill);

const REPORT_WEEK = '/reports?from=2026-01-05&to=2026-01-11';

/** Seeds one billable entry on Monday 5 January 2026 so the summary chart draws a billable bar. */
async function seedBillableEntry(page: Page) {
  const me = await page.request.get('/api/v9/me');
  expect(me.ok()).toBe(true);
  const { default_workspace_id: workspace } = await me.json() as { default_workspace_id: number };
  const response = await page.request.post(`/api/v9/workspaces/${workspace}/time_entries`, {
    headers: CSRF,
    data: { description: 'Theme check', billable: true, start: '2026-01-05T09:00:00Z', stop: '2026-01-05T11:00:00Z', created_with: 'e2e' },
  });
  expect(response.ok()).toBe(true);
}

/** Picks a theme in the Settings Theme select and saves the Preferences card. */
async function chooseTheme(page: Page, label: 'Match the system' | 'Light' | 'Dark') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  const preferences = page.getByRole('form', { name: 'Preferences' });
  await preferences.getByLabel('Theme').selectOption({ label });
  await preferences.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
}

async function expectPageColours(page: Page, colours: TokenColours, scheme: Scheme) {
  await expect.poll(() => pageBackground(page), { message: `page background in the ${scheme} scheme` })
    .toBe(colours[scheme]['--bg']);
}

async function expectChartColours(page: Page, colours: TokenColours, scheme: Scheme) {
  await page.goto(REPORT_WEEK);
  await expect(page.getByRole('tablist', { name: 'Report type' }).getByRole('tab', { name: 'Summary' }))
    .toHaveAttribute('aria-selected', 'true');
  const bar = page.locator('.chart-frame path.mark-billable');
  await expect(bar).toHaveCount(1);
  await expect.poll(() => fill(bar), { message: `billable bar fill in the ${scheme} scheme` })
    .toBe(colours[scheme]['--chart-billable']);
}

test('choosing Dark on a light system darkens the page and the report chart', async ({ page, browser, baseURL }) => {
  const colours = await systemTokenColours(browser, baseURL!);
  await login(page);
  await seedBillableEntry(page);
  await chooseTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectPageColours(page, colours, 'dark');
  await expectChartColours(page, colours, 'dark');
});

test('choosing Light wins over a dark system preference', async ({ page, browser, baseURL }) => {
  const colours = await systemTokenColours(browser, baseURL!);
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page);
  expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
  await seedBillableEntry(page);
  await chooseTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectPageColours(page, colours, 'light');
  await expectChartColours(page, colours, 'light');
});

test('Match the system follows the emulated color scheme', async ({ page, browser, baseURL }) => {
  const colours = await systemTokenColours(browser, baseURL!);
  await login(page);
  await seedBillableEntry(page);
  // Start from Dark so picking "Match the system" is a real change in the select.
  await saveTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await chooseTheme(page, 'Match the system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expectPageColours(page, colours, 'light');
  await expectChartColours(page, colours, 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectChartColours(page, colours, 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expectPageColours(page, colours, 'dark');
});
