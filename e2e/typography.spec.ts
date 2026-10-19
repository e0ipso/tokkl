import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

// The Anybody variable font ships with the app, is preloaded once, loads under the CSP
// (font-src 'self') and sets headings, the running clock and totals.
// The wordmark is the owner's artwork as an image named "Tokkl", not text set in a font.
// The root font size is 93.75%, so 1rem is 15px.

const FONT = '/fonts/anybody-wdth-wght.woff2';

const fontFamily = (target: Locator) => target.evaluate((el) => getComputedStyle(el).fontFamily);

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
  // The brand is the wordmark alone. A small extra image could slip past the visual baselines'
  // threshold, so every .brand must hold exactly one img, the one named Tokkl.
  const brands = page.locator('.brand');
  await expect(brands).not.toHaveCount(0);
  for (const brand of await brands.all()) {
    await expect(brand.locator('img')).toHaveCount(1);
    await expect(brand.locator('img')).toHaveAccessibleName('Tokkl');
  }
});
