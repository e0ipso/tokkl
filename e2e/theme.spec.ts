import { request, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { currentAccount, expect, test } from './fixtures.ts';
import { meWithSession, sessionCookie } from './auth-tests-helpers.ts';
import { login } from './helpers.ts';

// TT-0073: the theme saved on the server is cached in the browser and applied before React
// mounts, so a dark choice on a light system never flashes the light UI on reload.
// TT-0098: a blocking script in the head applies that cache, so it holds even when the bundle is slow.
// TT-0075: the theme picked in Settings decides the page and chart colours.
// TT-0080: the two media-scoped theme-color metas follow that choice, and "Match the system" restores them.
// TT-0129: a failed logout request and an expired session also clear the cached theme.
// TT-0155: when the failed request leaves the user signed in, the reloaded page says so.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const CACHE_KEY = 'tokkl.theme';
// The cache key before the rename to Tokkl (TT-0113).
const LEGACY_CACHE_KEY = 'timetrack.theme';

type Theme = 'system' | 'light' | 'dark';

async function saveTheme(page: Page, theme: Theme) {
  const response = await page.request.post('/api/v9/me/preferences', { headers: CSRF, data: { theme } });
  expect(response.ok()).toBe(true);
}

const dataTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const cachedTheme = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), CACHE_KEY);

/**
 * Reloads and reads data-theme at DOMContentLoaded. The preferences response is held until the
 * read, since on a fast server it can arrive first and apply the server's theme. A test that holds
 * it longer keeps its own route; this one falls back to it.
 */
async function themeAtFirstParse(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const hold = async (route: Route) => {
    await held;
    await route.fallback();
  };
  await page.route('**/api/v9/me/preferences', hold);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    return await dataTheme(page);
  } finally {
    release();
    await page.unroute('**/api/v9/me/preferences', hold);
  }
}

test.use({ colorScheme: 'light' });

// The shared fixture does not reset the theme, so put the account back on the default.
test.afterEach(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  try {
    const { email, password } = currentAccount();
    expect((await api.post('/api/app/login', { headers: CSRF, data: { email, password } })).ok()).toBe(true);
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

test('a theme cached under the old timetrack.theme key applies before first paint and moves to the new key', async ({ page }) => {
  await login(page);
  await saveTheme(page, 'dark');
  await page.evaluate(({ key, legacy }) => {
    window.localStorage.removeItem(key);
    window.localStorage.setItem(legacy, 'dark');
  }, { key: CACHE_KEY, legacy: LEGACY_CACHE_KEY });

  // Hold the preferences response so only the old cache entry can have set the attribute.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v9/me/preferences', async (route) => {
    await held;
    await route.continue();
  });
  expect(await themeAtFirstParse(page)).toBe('dark');
  expect(await cachedTheme(page)).toBe('dark');
  expect(await page.evaluate((legacy) => window.localStorage.getItem(legacy), LEGACY_CACHE_KEY)).toBeNull();
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

/** Logs in, saves a dark theme and reloads, so the theme is both on <html> and in the cache. */
async function loginWithCachedDark(page: Page) {
  await login(page);
  await saveTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');
}

test('a failed logout request still clears the cached theme', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: /^\/api\/app\/logout$/, reason: 'the logout response is replaced with a server error' });
  runtimeErrors.allowResponse({ status: 403, method: 'GET', path: /^\/api\/v9\/me$/, reason: 'the browser keeps the cookie of the session the server ended' });
  await loginWithCachedDark(page);

  // The server ends the session, but the browser gets a 500 and keeps its cookie.
  await page.route('**/api/app/logout', async (route) => {
    await route.fetch();
    await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
  });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await cachedTheme(page)).toBeNull();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  // The session did end, so there is no "still signed in" message.
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a logout the server never carries out clears the cache, then says the user is still signed in', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: /^\/api\/app\/logout$/, reason: 'the logout request fails before the server ends the session' });
  await loginWithCachedDark(page);
  const failLogout = (route: Route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
  await page.route('**/api/app/logout', failLogout);
  const message = page.getByRole('alert').filter({ hasText: 'Log out failed. You are still signed in.' });
  const buttons = {
    sidebar: () => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }),
    Settings: () => page.getByRole('region', { name: 'Session' }).getByRole('button', { name: 'Log out' }),
  };

  for (const [where, button] of Object.entries(buttons)) {
    if (where === 'Settings') await page.getByRole('link', { name: 'Settings' }).click();
    // Hold the reloaded page's preferences, so the cleared theme cannot be cached again before the check.
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const hold = async (route: Route) => {
      await held;
      await route.fallback();
    };
    await page.route('**/api/v9/me/preferences', hold);
    await button().click();
    await expect(message, where).toBeVisible();
    expect(await cachedTheme(page), where).toBeNull();
    await expect(page.locator('html'), where).not.toHaveAttribute('data-theme');
    release();
    await page.unroute('**/api/v9/me/preferences', hold);
    // Still signed in: the account's own theme comes back from the server.
    await expect(page.locator('html'), where).toHaveAttribute('data-theme', 'dark');
    if (where === 'sidebar') await message.getByRole('button', { name: 'Dismiss' }).click();
    await expect(message).toHaveCount(where === 'sidebar' ? 0 : 1);
  }

  // Try again once the server answers: the session ends, and logging in again shows no message.
  await page.unroute('**/api/app/logout', failLogout);
  await message.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await login(page);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(message).toHaveCount(0);
});

test('an expired session clears the cached theme once, and the login page follows the system', async ({ page, browser, baseURL, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 403, method: 'GET', path: /^\/api\/v9\/me$/, reason: 'the browser still sends the cookie of a session the server ended' });
  const colours = await systemTokenColours(browser, baseURL!);
  await loginWithCachedDark(page);

  // End the session on the server only. The browser keeps sending the dead cookie, as after expiry.
  const session = await sessionCookie(page, baseURL!);
  const other = await request.newContext({ baseURL, extraHTTPHeaders: { ...CSRF, cookie: `tokkl_session=${session}` } });
  try {
    expect((await other.post('/api/app/logout')).ok()).toBe(true);
  } finally {
    await other.dispose();
  }
  expect(await meWithSession(baseURL!, session)).toBe(403);

  const meRequests: string[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname === '/api/v9/me') meRequests.push(sent.url());
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await cachedTheme(page)).toBeNull();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(colours.light['--bg']);

  // One probe on load and one after the cache is cleared. Refocusing the tab refetches /me once
  // more, and that 403 clears nothing. A loop would refetch within milliseconds, so a quiet
  // second after each step shows there is none.
  const isMe = (response: { url(): string }) => new URL(response.url()).pathname === '/api/v9/me';
  await expect.poll(() => meRequests.length).toBe(2);
  await page.waitForTimeout(1_000);
  expect(meRequests).toHaveLength(2);
  const refetched = page.waitForResponse(isMe);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    window.dispatchEvent(new Event('focus'));
  });
  await refetched;
  await page.waitForTimeout(1_000);
  expect(meRequests).toHaveLength(3);

  // Logging in on that same page works, and the saved theme comes back.
  await page.getByLabel('Email').fill(currentAccount().email);
  await page.getByLabel('Password').fill(currentAccount().password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await cachedTheme(page)).toBe('dark');
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

/**
 * The light and dark theme-color metas' colours, in that order, resolved to rgb() through a probe so
 * they compare with the --bg token values.
 */
const themeColors = (page: Page) => page.evaluate(() => (['light', 'dark'] as const).map((scheme) => {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`);
  const probe = document.createElement('div');
  probe.style.backgroundColor = meta?.content ?? '';
  document.body.append(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}));

/** An explicit theme puts its own --bg in both metas; with none, each meta keeps its scheme's --bg. */
async function expectThemeColors(page: Page, colours: TokenColours, theme: Scheme | null) {
  const expected = theme ? [colours[theme]['--bg'], colours[theme]['--bg']] : [colours.light['--bg'], colours.dark['--bg']];
  await expect.poll(() => themeColors(page), { message: 'theme-color metas, light then dark' }).toEqual(expected);
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
  await expectThemeColors(page, colours, null);
  await chooseTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectPageColours(page, colours, 'dark');
  await expectThemeColors(page, colours, 'dark');
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
  await expectThemeColors(page, colours, 'light');
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
  // The cached dark theme fills both metas on load, before Settings changes anything.
  await expectThemeColors(page, colours, 'dark');
  await chooseTheme(page, 'Match the system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expectPageColours(page, colours, 'light');
  await expectThemeColors(page, colours, null);
  await expectChartColours(page, colours, 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectChartColours(page, colours, 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expectPageColours(page, colours, 'dark');
});
