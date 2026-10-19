import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Derives the served brand images in packages/web/public from the owner's artwork in docs/brand.
// Run it with `npm run icons` after replacing a file in docs/brand and commit the outputs with it.
//
// Resizing and palette reduction use ImageMagick 7 (`magick`). Chromium can resize but cannot
// write a palette PNG, and the 512px icon and the 2x wordmark only fit the 100 KB budget for served
// images as 256-colour PNGs with alpha. Outputs carry no metadata or timestamps, so the same
// ImageMagick build writes identical files on every run.

const BRAND = fileURLToPath(new URL('../docs/brand/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../packages/web/public/', import.meta.url));

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

function magick(args: string[], out: string) {
  execFileSync('magick', [...args, ...STRIP, `png:${out}`], { stdio: 'inherit' });
  console.log(`wrote ${out}`);
}

function copy(source: string, out: string) {
  copyFileSync(`${BRAND}${source}`, out);
  console.log(`wrote ${out}`);
}

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('npm run icons needs ImageMagick 7: the `magick` command was not found on PATH.');
  process.exit(1);
}

mkdirSync(`${PUBLIC}brand`, { recursive: true });

// The owner supplied the 32 and 192 sizes, and both are already small, so they ship as is.
copy('tokkl-favicon-v4-32.png', `${PUBLIC}favicon-32.png`);
copy('tokkl-icon-v4-192.png', `${PUBLIC}icon-192.png`);
magick([`${BRAND}tokkl-icon-v4-512.png`, ...PALETTE], `${PUBLIC}icon-512.png`);

// The owner's mobile exports are final: opaque navy (#01013A) art, so they ship byte for byte. The
// maskable pair keeps its artwork inside the Android safe zone, and iOS gets the 180px touch icon.
copy('icon-maskable-192.png', `${PUBLIC}icon-maskable-192.png`);
copy('icon-maskable-512.png', `${PUBLIC}icon-maskable-512.png`);
copy('apple-touch-icon.png', `${PUBLIC}apple-touch-icon.png`);

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
