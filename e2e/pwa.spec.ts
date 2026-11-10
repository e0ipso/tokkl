import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const ICON_PACK = fileURLToPath(new URL('../docs/brand/icon-pack/web/public/', import.meta.url));

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

const MAX_ICON_BYTES = 100 * 1024;
// Maskable icons go up to 1024 px and load only when installed, so they get a larger budget.
const MAX_MASKABLE_ICON_BYTES = 128 * 1024;

interface Manifest {
  id?: unknown;
  name?: unknown;
  start_url?: unknown;
  display?: unknown;
  scope?: unknown;
  theme_color?: unknown;
  background_color?: unknown;
  icons?: ManifestIcon[];
}

async function decodeImage(page: Page, src: string) {
  return page.evaluate(async url => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minAlpha = 255;
    for (let i = 3; i < data.length; i += 4) minAlpha = Math.min(minAlpha, data[i]!);
    return { size: `${image.naturalWidth}x${image.naturalHeight}`, minAlpha };
  }, src);
}

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
  const manifest = (await response.json()) as Manifest;

  expect(typeof manifest.name === 'string' && manifest.name.trim()).toBeTruthy();
  expect(['fullscreen', 'standalone', 'minimal-ui', 'browser']).toContain(manifest.display);
  expect(typeof manifest.start_url).toBe('string');
  const startUrl = new URL(manifest.start_url as string, manifestUrl);
  expect(startUrl.origin).toBe(origin);
  // Identity and scope are the site root, so an install survives a changed start URL. The id resolves against its origin.
  expect(typeof manifest.id).toBe('string');
  expect(new URL(manifest.id as string, startUrl.origin).href).toBe(`${origin}/`);
  expect(typeof manifest.scope).toBe('string');
  const scope = new URL(manifest.scope as string, manifestUrl);
  expect(scope.href).toBe(`${origin}/`);
  expect(startUrl.href.startsWith(scope.href)).toBe(true);

  expect([manifest.theme_color, manifest.background_color]).toEqual(['#291329', '#291329']);

  // The artwork is raster, so the manifest lists only PNG sizes; the pack's 1024 px general icon is too large to serve.
  expect(manifest.icons?.map(icon => [icon.src, icon.sizes, icon.type, icon.purpose ?? 'any'])).toEqual([
    ['/icons/icon-192.png', '192x192', 'image/png', 'any'],
    ['/icons/icon-512.png', '512x512', 'image/png', 'any'],
    ['/icons/maskable-192.png', '192x192', 'image/png', 'maskable'],
    ['/icons/maskable-512.png', '512x512', 'image/png', 'maskable'],
    ['/icons/maskable-1024.png', '1024x1024', 'image/png', 'maskable'],
  ]);
  for (const icon of manifest.icons!) {
    const maskable = icon.purpose === 'maskable';
    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.origin, icon.src).toBe(origin);
    const iconResponse = await page.request.get(iconUrl.href);
    expect(iconResponse.status(), icon.src).toBe(200);
    // The server answers unknown paths with the HTML app shell, so the type is what proves the file exists.
    expect(iconResponse.headers()['content-type']?.split(';')[0], icon.src).toBe(icon.type);
    const body = await iconResponse.body();
    expect(body.length, icon.src).toBeLessThan(maskable ? MAX_MASKABLE_ICON_BYTES : MAX_ICON_BYTES);
    // Colour type 3 in the IHDR chunk: the manifest icons are palette PNGs, which keeps them in budget.
    expect(body.readUInt8(25), `${icon.src} PNG colour type`).toBe(3);

    const decoded = await decodeImage(page, iconUrl.href);
    const sizes = (icon.sizes ?? '').split(/\s+/).filter(Boolean);
    expect(sizes.length, icon.src).toBeGreaterThan(0);
    if (sizes.includes('any')) {
      expect(icon.type, `${icon.src} declares "any", which only a scalable format can honor`).toBe('image/svg+xml');
      expect(decoded.size, icon.src).not.toBe('0x0');
    } else {
      expect(sizes, icon.src).toContain(decoded.size);
    }
    // A maskable icon fills its whole square, because the launcher crops it to its own shape.
    expect(decoded.minAlpha, icon.src).toBe(maskable ? 255 : 0);
  }
});

function icoSizes(bytes: Buffer) {
  expect([bytes.readUInt16LE(0), bytes.readUInt16LE(2)], 'ICO header').toEqual([0, 1]);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
    // A stored 0 means 256 pixels.
    const width = bytes.readUInt8(6 + index * 16) || 256;
    const height = bytes.readUInt8(7 + index * 16) || 256;
    return `${width}x${height}`;
  });
}

// The Apple touch icons are opaque, because iOS paints transparent corners black.
test('the favicon and apple-touch-icon links resolve to images of their declared sizes', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const links = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll(elements =>
      elements.map(link => [link.getAttribute('rel'), link.getAttribute('href'), link.getAttribute('sizes')]),
    );
  expect(links).toEqual([
    ['icon', '/favicon.ico', '16x16 32x32 48x48'],
    ['icon', '/icons/favicon-32.png', '32x32'],
    ['icon', '/icons/favicon-16.png', '16x16'],
    ['apple-touch-icon', '/icons/apple-touch-icon-120.png', '120x120'],
    ['apple-touch-icon', '/icons/apple-touch-icon-152.png', '152x152'],
    ['apple-touch-icon', '/icons/apple-touch-icon-167.png', '167x167'],
    ['apple-touch-icon', '/apple-touch-icon.png', '180x180'],
  ]);
  for (const [rel, href, declared] of links as [string, string, string][]) {
    const sizes = declared.split(' ');
    const url = new URL(href, page.url());
    expect(url.origin, href).toBe(origin);
    const response = await page.request.get(url.href);
    expect(response.status(), href).toBe(200);
    const body = await response.body();
    expect(body.length, href).toBeLessThan(MAX_ICON_BYTES);
    if (href.endsWith('.ico')) {
      expect(response.headers()['content-type'], href).toMatch(/^image\/(vnd\.microsoft\.icon|x-icon)$/);
      expect(icoSizes(body), href).toEqual(sizes);
    } else {
      expect(response.headers()['content-type'], href).toBe('image/png');
    }

    const decoded = await decodeImage(page, url.href);
    expect(sizes, href).toContain(decoded.size);
    expect(decoded.minAlpha, href).toBe(rel === 'apple-touch-icon' ? 255 : 0);
  }
});

// Retired and oversized icons are not served, so the server answers them with the HTML app shell.
test('the served touch icons are the icon pack files, and retired icons are not served', async ({ page }) => {
  const copied = [
    'apple-touch-icon.png',
    'icons/apple-touch-icon-120.png',
    'icons/apple-touch-icon-152.png',
    'icons/apple-touch-icon-167.png',
    'icons/apple-touch-icon-180.png',
  ];
  for (const file of copied) {
    const response = await page.request.get(`/${file}`);
    expect(response.status(), file).toBe(200);
    expect((await response.body()).equals(readFileSync(`${ICON_PACK}${file}`)), `${file} matches the icon pack`).toBe(
      true,
    );
  }

  const retired = [
    '/icons/icon-1024.png',
    '/favicon-32.png',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable-192.png',
    '/icon-maskable-512.png',
  ];
  for (const path of retired) {
    const response = await page.request.get(path);
    expect(response.headers()['content-type']?.split(';')[0], path).toBe('text/html');
  }
});
