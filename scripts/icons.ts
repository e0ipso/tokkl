import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Derives the brand images that Tokkl ships from the owner's artwork in docs/brand: the web app's
// icons and wordmarks in packages/web/public, the README wordmarks in docs/brand, the KDE
// widget's icons in desktop/kde/package, the GNOME extension's logos in desktop/gnome/extension and
// the macOS app's iconset and menu bar logos in desktop/macos/resources. Run it with
// `npm run icons` after replacing a file in docs/brand and commit the outputs with it.
//
// Resizing and palette reduction use ImageMagick 7 (`magick`). Chromium can resize but cannot
// write a palette PNG, and the larger manifest icons and the 2x wordmark only fit the size budgets
// for served images as 256-colour PNGs. Outputs carry no metadata or timestamps, so the same
// ImageMagick build writes identical files on every run.

const BRAND = fileURLToPath(new URL('../docs/brand/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../packages/web/public/', import.meta.url));
const KDE_PACKAGE = fileURLToPath(new URL('../desktop/kde/package/', import.meta.url));
const GNOME_EXTENSION = fileURLToPath(new URL('../desktop/gnome/extension/', import.meta.url));
const MACOS_RESOURCES = fileURLToPath(new URL('../desktop/macos/resources/', import.meta.url));
const MACOS_ICONSET = `${MACOS_RESOURCES}Tokkl.iconset/`;
/** The icon pack's opaque touch and maskable exports. */
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
 * The icon pack's transparent logos at their largest size. The pack centres the clock body rather
 * than the whole art, whose drip hangs below it, and fits the art in a centred 84% square. Every
 * transparent icon is one of these resized, so it keeps that placement: do not trim or recentre.
 * The outlines are the monochrome logos, with a hollow rim, hands and pivot.
 */
const LOGO = `${BRAND}icon-pack/logo/color-1024.png`;
const OUTLINE_BLACK = `${BRAND}icon-pack/logo/outline-black-1024.png`;
const OUTLINE_WHITE = `${BRAND}icon-pack/logo/outline-white-1024.png`;

/**
 * The outline's strokes are 5.7 px wide at 256 px, under half a pixel where a panel draws the logo.
 * Panel logos dilate the outline's alpha at 256 px with a disk until each stroke is PANEL_STROKE
 * logical pixels wide at the size the panel draws it.
 */
const OUTLINE_STROKE_AT_256 = 5.7;
const PANEL_STROKE = 1.5;
function panelOutline(outline: string, drawnSize: number) {
  const radius = Math.round(((PANEL_STROKE * 256) / drawnSize - OUTLINE_STROKE_AT_256) / 2);
  return [outline, '-resize', '256x256', '-channel', 'A', '-morphology', 'Dilate', `Disk:${radius}`, '+channel'];
}

const STRIP = ['-strip', '-define', 'png:exclude-chunks=date,time'];
const PALETTE = ['-colors', '256'];
/** Sets every pixel's RGB to one ink and keeps the alpha, so a monochrome logo has a single colour. */
const ink = (value: string) => ['-channel', 'RGB', '-evaluate', 'set', value, '+channel'];

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

// Apple touch icons stay opaque. index.html links the root copy of the 180px touch icon,
// the path iOS also tries when a page links none.
const copiedIcons = [
  'apple-touch-icon.png',
  'icons/apple-touch-icon-120.png',
  'icons/apple-touch-icon-152.png',
  'icons/apple-touch-icon-167.png',
  'icons/apple-touch-icon-180.png',
];
for (const file of copiedIcons) copyIcon(file);

// Favicons and general-purpose launcher icons keep the logo's transparent background.
// Maskable icons retain their opaque tile because the launcher crops them to its own shape.
for (const size of [16, 32, 48, 192, 512]) {
  const name = size < 100 ? `favicon-${size}.png` : `icon-${size}.png`;
  magick([LOGO, '-resize', `${size}x${size}`, '-dither', 'None', ...PALETTE],
    `${PUBLIC}icons/${name}`, 'png8');
}
execFileSync('magick', [
  ...[16, 32, 48].map((size) => `${PUBLIC}icons/favicon-${size}.png`),
  ...STRIP, `${PUBLIC}favicon.ico`,
], { stdio: 'inherit' });

// The maskable icons ship as undithered 256-colour PNG8 files. As supplied, the 512 and 1024 sizes
// exceed the 100 KB and 128 KB budgets in e2e/pwa.spec.ts. The pack's icon-1024.png is not served,
// because it stays over 100 KB even quantised.
const quantisedIcons = [
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
magick([LOGO, '-resize', '96x96'], kdeLogo, 'png32');
// The software scene graph does not tint icon masks, so pre-coloured monochrome assets
// also keep the logo readable there. The hardware renderer tints them to the exact panel ink.
// PanelButton.qml draws the logo at Kirigami's smallMedium icon size, 22px.
for (const [name, outline, value] of [['dark', OUTLINE_BLACK, '0'], ['light', OUTLINE_WHITE, '100%']] as const) {
  magick([...panelOutline(outline, 22), '-resize', '96x96', ...ink(value)],
    `${KDE_PACKAGE}contents/images/tokkl-mono-${name}.png`, 'png32');
}
for (const size of [32, 48, 64, 96, 128, 256]) {
  if (size === 96) {
    copyFileSync(kdeLogo, kdeIcon(size));
    console.log(`wrote ${kdeIcon(size)}`);
  } else {
    magick([LOGO, '-resize', `${size}x${size}`], kdeIcon(size), 'png32');
  }
}

// The GNOME extension shows tokkl.png before the project indicator in its top bar button, at the
// 16px panel icon size. It is a full-colour RGBA PNG at 32px, so it stays sharp at twice that size.
magick([LOGO, '-resize', '32x32'], `${GNOME_EXTENSION}tokkl.png`, 'png32');
// GNOME's symbolic PNG loader maps black RGB pixels to the panel foreground and keeps alpha.
magick([...panelOutline(OUTLINE_BLACK, 16), '-resize', '32x32', ...ink('0')],
  `${GNOME_EXTENSION}tokkl-symbolic.symbolic.png`, 'png32');

// The macOS build turns the iconset into Tokkl.icns with `iconutil -c icns`, and Info.plist names
// it in CFBundleIconFile. iconutil takes the files by these names: each size at 1x and 2x, from 16
// to 512 points. They are full-colour RGBA PNGs of the logo as it is, not template images.
mkdirSync(MACOS_ICONSET, { recursive: true });
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = points * scale;
    const name = `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`;
    const out = `${MACOS_ICONSET}${name}`;
    magick([LOGO, '-resize', `${pixels}x${pixels}`], out, 'png32');
  }
}

// The monochrome menu bar logo is the outline at 16 points, 1x and 2x. The status item fills its
// alpha with the menu bar's label colour, so only the alpha matters; the ink is black.
for (const [pixels, name] of [[16, 'mono_16x16.png'], [32, 'mono_16x16@2x.png']] as const) {
  magick([...panelOutline(OUTLINE_BLACK, 16), '-resize', `${pixels}x${pixels}`, ...ink('0')],
    `${MACOS_RESOURCES}${name}`, 'png32');
}
