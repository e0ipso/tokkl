import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Derives the served brand images in packages/web/public from the owner's artwork in docs/brand.
// Run it with `npm run icons` after replacing a file in docs/brand and commit the outputs with it.
//
// Resizing and palette reduction use ImageMagick 7 (`magick`). Chromium can resize but cannot
// write a palette PNG, and the larger manifest icons and the 2x wordmark only fit the size budgets
// for served images as 256-colour PNGs. Outputs carry no metadata or timestamps, so the same
// ImageMagick build writes identical files on every run.

const BRAND = fileURLToPath(new URL('../docs/brand/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../packages/web/public/', import.meta.url));
/** The icon pack's web root. Every served icon keeps its path from here under packages/web/public. */
const ICON_PACK = `${BRAND}icon-pack/web/public/`;

/**
 * The wordmark pack's raster master, with the clock in place of the "o". Its artwork touches the
 * top and bottom edges, so the crop trims to the alpha bounds and then adds a 4px transparent
 * border, which extends the canvas to 2059x769. WORDMARK_RATIO in Brand.tsx is its height over
 * width, so change both together.
 */
const WORDMARK_SOURCE = `${BRAND}wordmark-pack/source/tokkl-wordmark-clock-master.png`;
const WORDMARK_CROP = ['-trim', '+repage', '-bordercolor', 'none', '-border', '4'];

const STRIP = ['-strip', '-define', 'png:exclude-chunks=date,time'];
const PALETTE = ['-colors', '256'];

function magick(args: string[], out: string, format = 'png') {
  execFileSync('magick', [...args, ...STRIP, `${format}:${out}`], { stdio: 'inherit' });
  console.log(`wrote ${out}`);
}

function copyIcon(file: string) {
  copyFileSync(`${ICON_PACK}${file}`, `${PUBLIC}${file}`);
  console.log(`wrote ${PUBLIC}${file}`);
}

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('npm run icons needs ImageMagick 7: the `magick` command was not found on PATH.');
  process.exit(1);
}

mkdirSync(`${PUBLIC}brand`, { recursive: true });
mkdirSync(`${PUBLIC}icons`, { recursive: true });

// The favicons and Apple touch icons are small, so they ship byte for byte. index.html links the
// root copy of the 180px touch icon, the path iOS also tries when a page links none.
const copiedIcons = [
  'favicon.ico',
  'apple-touch-icon.png',
  'icons/favicon-16.png',
  'icons/favicon-32.png',
  'icons/favicon-48.png',
  'icons/apple-touch-icon-120.png',
  'icons/apple-touch-icon-152.png',
  'icons/apple-touch-icon-167.png',
  'icons/apple-touch-icon-180.png',
];
for (const file of copiedIcons) copyIcon(file);

// The manifest icons ship as undithered 256-colour PNG8 files. As supplied, the 512 and 1024 sizes
// exceed the 100 KB and 128 KB budgets in e2e/pwa.spec.ts. The pack's icon-1024.png is not served,
// because it stays over 100 KB even quantised.
const quantisedIcons = [
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/maskable-1024.png',
];
for (const file of quantisedIcons) {
  magick([`${ICON_PACK}${file}`, '-dither', 'None', ...PALETTE], `${PUBLIC}${file}`, 'png8');
}

// Brand.tsx shows the wordmark at up to 260 CSS pixels wide; the 520 file is for 2x screens. The
// 640 copy in docs/brand is the README header, shown 320 wide. tokkl-wordmark-full.png in
// docs/brand is the crop at full width, for other clients that need the wordmark wider than 640 px.
const wordmarks: [string[], string][] = [
  [['-resize', '260x'], `${PUBLIC}brand/wordmark-260.png`],
  [['-resize', '520x'], `${PUBLIC}brand/wordmark-520.png`],
  [['-resize', '640x'], `${BRAND}tokkl-wordmark.png`],
  [[], `${BRAND}tokkl-wordmark-full.png`],
];
for (const [resize, out] of wordmarks) {
  magick([WORDMARK_SOURCE, ...WORDMARK_CROP, ...resize, ...PALETTE], out);
}
