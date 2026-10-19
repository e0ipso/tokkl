import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Derives the brand images that Tokkl ships from the owner's artwork in docs/brand: the web app's
// icons and wordmarks in packages/web/public, the README wordmarks in docs/brand, the KDE
// widget's icons in desktop/kde/package, the GNOME extension's logo in desktop/gnome/extension and
// the macOS app's iconset in desktop/macos/resources. Run it with `npm run icons` after replacing a
// file in docs/brand and commit the outputs with it.
//
// Resizing and palette reduction use ImageMagick 7 (`magick`). Chromium can resize but cannot
// write a palette PNG, and the larger manifest icons and the 2x wordmark only fit the size budgets
// for served images as 256-colour PNGs. Outputs carry no metadata or timestamps, so the same
// ImageMagick build writes identical files on every run.

const BRAND = fileURLToPath(new URL('../docs/brand/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../packages/web/public/', import.meta.url));
const KDE_PACKAGE = fileURLToPath(new URL('../desktop/kde/package/', import.meta.url));
const GNOME_EXTENSION = fileURLToPath(new URL('../desktop/gnome/extension/', import.meta.url));
const MACOS_ICONSET = fileURLToPath(
  new URL('../desktop/macos/resources/Tokkl.iconset/', import.meta.url),
);
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

/**
 * The icon pack's master artwork. The clock is taller than wide inside its transparent square, so
 * the KDE, GNOME and macOS icons trim it to its alpha bounds and centre it on a square transparent
 * canvas as tall as the art, which fills the icon without distorting it.
 */
const MASTER = `${BRAND}icon-pack/source/master-export.png`;
const MASTER_SQUARE = [
  ...['-trim', '+repage'],
  ...['-background', 'none', '-gravity', 'center', '-extent', '%[fx:max(w,h)]x%[fx:max(w,h)]'],
];

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

// The KDE widget shows contents/images/tokkl.png on the panel, and the packages install the hicolor
// icons for the widget picker, which finds them through KPlugin.Icon in metadata.json. All are
// full-colour RGBA PNGs. The 96px hicolor icon is a copy of tokkl.png: the smokeload test and
// check-package.sh require them to match.
const kdeLogo = `${KDE_PACKAGE}contents/images/tokkl.png`;
const kdeIcon = (size: number) => `${KDE_PACKAGE}icons/tokkl-${size}.png`;
mkdirSync(`${KDE_PACKAGE}icons`, { recursive: true });
magick([MASTER, ...MASTER_SQUARE, '-resize', '96x96'], kdeLogo, 'png32');
for (const size of [32, 48, 64, 96, 128, 256]) {
  if (size === 96) {
    copyFileSync(kdeLogo, kdeIcon(size));
    console.log(`wrote ${kdeIcon(size)}`);
  } else {
    magick([MASTER, ...MASTER_SQUARE, '-resize', `${size}x${size}`], kdeIcon(size), 'png32');
  }
}

// The GNOME extension shows tokkl.png before the project indicator in its top bar button, at the
// 16px panel icon size. It is a full-colour RGBA PNG at 32px, so it stays sharp at twice that size.
magick([MASTER, ...MASTER_SQUARE, '-resize', '32x32'], `${GNOME_EXTENSION}tokkl.png`, 'png32');

// The macOS build turns the iconset into Tokkl.icns with `iconutil -c icns`, and Info.plist names
// it in CFBundleIconFile. iconutil takes the files by these names: each size at 1x and 2x, from 16
// to 512 points. They are full-colour RGBA PNGs of the logo as it is, not template images.
mkdirSync(MACOS_ICONSET, { recursive: true });
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = points * scale;
    const name = `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`;
    const out = `${MACOS_ICONSET}${name}`;
    magick([MASTER, ...MASTER_SQUARE, '-resize', `${pixels}x${pixels}`], out, 'png32');
  }
}
