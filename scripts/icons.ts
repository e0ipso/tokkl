import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Renders web/public/icon-192.png and web/public/icon-512.png from web/public/icon.svg.
// Run it with `npm run icons` after changing the SVG and commit the PNGs with it.
//
// It draws the SVG as an <img> in Playwright's Chromium and screenshots it with an opaque
// background, so no extra image tool is needed. CHROMIUM_PATH picks another Chromium binary, as
// for the e2e tests. The same Chromium build writes byte-identical files on every run.

const PUBLIC_DIR = new URL('../web/public/', import.meta.url);
const SIZES = [192, 512];

const svg = readFileSync(new URL('icon.svg', PUBLIC_DIR));
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
    const out = new URL(`icon-${size}.png`, PUBLIC_DIR);
    writeFileSync(out, png);
    console.log(`wrote ${fileURLToPath(out)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
