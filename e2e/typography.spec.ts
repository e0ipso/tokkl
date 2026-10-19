import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { PHONE } from './mobile-tests-helpers.ts';

// The Anybody variable font ships with the app, is preloaded once, loads under the CSP
// (font-src 'self') and sets headings, the running clock and totals.
// The wordmark is the owner's artwork as an image named "Tokkl", not text set in a font.
// The root font size is 93.75%, so 1rem is 15px.

const FONT = '/fonts/anybody-wdth-wght.woff2';

const fontFamily = (target: Locator) => target.evaluate((el) => getComputedStyle(el).fontFamily);

/**
 * The brand is the wordmark alone. A small extra image could slip past the visual baselines'
 * threshold, so every `.brand` on the page must hold exactly one img, the one named Tokkl.
 */
async function expectWordmarkAlone(page: Page) {
  const brands = page.locator('.brand');
  await expect(brands).not.toHaveCount(0);
  for (const brand of await brands.all()) {
    await expect(brand.locator('img')).toHaveCount(1);
    await expect(brand.locator('img')).toHaveAccessibleName('Tokkl');
  }
}

test('the font and its licence are served as files, not the app shell', async ({ request }) => {
  const font = await request.get(FONT);
  expect(font.status()).toBe(200);
  expect(font.headers()['content-type']).toBe('font/woff2');
  expect((await font.body()).subarray(0, 4).toString('latin1')).toBe('wOF2');

  const licence = await request.get('/fonts/OFL.txt');
  expect(licence.status()).toBe(200);
  expect(licence.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await licence.text()).toContain('SIL OPEN FONT LICENSE');
});

test('the preloaded font is fetched once, loads under the CSP and sets the display text', async ({ page, data }) => {
  const now = Date.now();
  await data.createEntry({
    description: 'Totals',
    start: new Date(now - 3 * 3_600_000).toISOString(),
    stop: new Date(now - 2 * 3_600_000).toISOString(),
  });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Clock check');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();

  const fetches: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === FONT) fetches.push(request.url());
  });
  const response = await page.reload();
  expect(response!.headers()['content-security-policy']).toContain("font-src 'self'");
  const preload = page.locator('link[rel="preload"][as="font"]');
  await expect(preload).toHaveAttribute('href', FONT);
  // Without crossorigin the browser cannot reuse the preload for @font-face and fetches twice.
  await expect(preload).toHaveAttribute('crossorigin', '');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();

  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.family.replace(/["']/g, '') === 'Anybody')
      .map((face) => face.status);
  })).toEqual(['loaded']);
  expect(fetches).toHaveLength(1);

  for (const target of [
    page.locator('.day-header h3').first(),
    page.locator('.day-total').first(),
    timer.locator('.timer-clock'),
  ]) {
    expect(await fontFamily(target)).toMatch(/^"?Anybody"?,/);
  }
  await expect(timer.locator('.timer-clock')).toHaveCSS('font-variant-numeric', 'tabular-nums');
  expect(await fontFamily(timer.getByLabel('Description'))).not.toMatch(/Anybody/);
  await expect(page.locator('html')).toHaveCSS('font-size', '15px');

  const wordmark = page.locator('.brand').first().getByRole('img', { name: 'Tokkl' });
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveJSProperty('tagName', 'IMG');
  await expect(wordmark).toHaveAttribute('src', /^\/brand\/wordmark-\d+\.png$/);
  // Loaded and decoded, not a broken image with only its alt text showing.
  expect(await wordmark.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return img.naturalWidth;
  })).toBeGreaterThan(0);
  await expect(page.locator('.sidebar .brand-md')).toBeVisible();
  await expectWordmarkAlone(page);
});

// The test above checks the sidebar's md brand; the login page shows lg and the phone header sm.
test('the brand is the wordmark alone on the login page and in the phone header', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.locator('.brand-lg')).toBeVisible();
  await expectWordmarkAlone(page);

  await page.setViewportSize(PHONE.viewport);
  await login(page);
  await expect(page.locator('.phone-header .brand-sm')).toBeVisible();
  await expectWordmarkAlone(page);
});

/**
 * Checks that the wordmark at this size is drawn `width` CSS pixels wide and as tall as the
 * served file's own proportions give, within the 1px the height attribute rounds to. A stale
 * height in Brand.tsx would squash or stretch the art. Returns the file the browser picked.
 */
async function expectWordmarkProportions(page: Page, size: 'sm' | 'md' | 'lg', width: number) {
  const img = page.locator(`.brand-${size} img`);
  await expect(img).toBeVisible();
  const drawn = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const box = el.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      ratio: el.naturalHeight / el.naturalWidth,
      file: new URL(el.currentSrc).pathname,
    };
  });
  expect(drawn.width).toBe(width);
  expect(Math.abs(drawn.height - width * drawn.ratio)).toBeLessThanOrEqual(1);
  return drawn.file;
}

// The art's navy outline matches bg in dark, so dark traces a light halo around it; light has none.
test('the wordmark has a halo in dark and none in light', async ({ page }) => {
  const filter = () => page.locator('.brand-lg img').evaluate((el) => getComputedStyle(el).filter);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect((await filter()).match(/drop-shadow\(rgb\(185, 181, 214\)/g)).toHaveLength(4);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(filter).not.toContain('rgb(185, 181, 214)');
  expect((await filter()).match(/drop-shadow\(rgba\(0, 0, 0, 0\)/g)).toHaveLength(4);
});

// lg is drawn 260 wide, so a 1x screen takes the 260 file and a 2x screen the 520 one.
for (const [scale, lgFile] of [[1, '/brand/wordmark-260.png'], [2, '/brand/wordmark-520.png']] as const) {
  test.describe(`at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale });

    test('the wordmark keeps its proportions at every size', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      expect(await expectWordmarkProportions(page, 'lg', 260)).toBe(lgFile);

      await login(page);
      await expectWordmarkProportions(page, 'md', 130);

      await page.setViewportSize(PHONE.viewport);
      await page.reload();
      await expectWordmarkProportions(page, 'sm', 84);
    });
  });
}
