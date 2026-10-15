import { expect, test } from './fixtures.ts';

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
}

interface Manifest {
  name?: unknown;
  start_url?: unknown;
  display?: unknown;
  scope?: unknown;
  theme_color?: unknown;
  background_color?: unknown;
  icons?: ManifestIcon[];
}

// Checks the manifest and icons the built app ships (dist/web, served by the real server). It
// does not cover installing the app on a phone.
test('the built app links a local manifest whose icons are real images of the declared size', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href!, page.url());
  expect(manifestUrl.origin).toBe(origin);

  const response = await page.request.get(manifestUrl.href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/(manifest\+)?json\b/);
  const manifest = await response.json() as Manifest;

  expect(typeof manifest.name === 'string' && manifest.name.trim()).toBeTruthy();
  expect(['fullscreen', 'standalone', 'minimal-ui', 'browser']).toContain(manifest.display);
  expect(typeof manifest.start_url).toBe('string');
  const startUrl = new URL(manifest.start_url as string, manifestUrl);
  expect(startUrl.origin).toBe(origin);
  // Without a scope member the browser uses the start URL's directory.
  const scope = typeof manifest.scope === 'string' ? new URL(manifest.scope, manifestUrl) : new URL('.', startUrl);
  expect(scope.origin).toBe(origin);
  expect(startUrl.href.startsWith(scope.href)).toBe(true);

  // TT-0080: an installed app opens in the light theme's --bg, the colour the light theme-color meta holds.
  const lightThemeColor = await page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]').getAttribute('content');
  expect(lightThemeColor).toMatch(/^#[0-9a-f]{6}$/i);
  expect([manifest.theme_color, manifest.background_color]).toEqual([lightThemeColor, lightThemeColor]);

  expect(manifest.icons?.length).toBeGreaterThan(0);
  for (const icon of manifest.icons!) {
    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.origin, icon.src).toBe(origin);
    const iconResponse = await page.request.get(iconUrl.href);
    expect(iconResponse.status(), icon.src).toBe(200);
    // The server answers unknown paths with the HTML app shell, so the type is what proves the file exists.
    expect(iconResponse.headers()['content-type']?.split(';')[0], icon.src).toBe(icon.type);

    const decoded = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, iconUrl.href);
    const sizes = (icon.sizes ?? '').split(/\s+/).filter(Boolean);
    expect(sizes.length, icon.src).toBeGreaterThan(0);
    if (sizes.includes('any')) {
      expect(icon.type, `${icon.src} declares "any", which only a scalable format can honor`).toBe('image/svg+xml');
      expect(decoded, icon.src).not.toBe('0x0');
    } else {
      expect(sizes, icon.src).toContain(decoded);
    }
  }
});

// TT-0079: the favicon and the apple-touch-icon in index.html point at real images, not the app shell.
test('the favicon and apple-touch-icon links resolve to images', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  for (const rel of ['icon', 'apple-touch-icon']) {
    const link = page.locator(`link[rel="${rel}"]`);
    await expect(link, rel).toHaveCount(1);
    const href = await link.getAttribute('href');
    expect(href, rel).toBeTruthy();
    const url = new URL(href!, page.url());
    expect(url.origin, rel).toBe(origin);
    const response = await page.request.get(url.href);
    expect(response.status(), rel).toBe(200);
    expect(response.headers()['content-type'], rel).toMatch(/^image\//);
  }
});
