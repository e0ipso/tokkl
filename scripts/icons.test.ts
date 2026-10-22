import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

// icons.ts runs ImageMagick when it is imported and writes into the checkout, so these tests read
// the committed files instead and check them against the crop and the icon pack files the script
// reads. Rerunning the script is not tested, because CI has no ImageMagick and only the same build
// writes the same bytes.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_PACK = 'docs/brand/icon-pack/web/public/';
const PUBLIC = 'packages/web/public/';
/** The manifest icons, which the script reduces to 256 colours and serves from the same path. */
const QUANTISED_ICONS = [
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/maskable-1024.png',
];
// Palette reduction moves each channel of a manifest icon by under 1 of 255 on average. A different
// icon of the pack at the same size is about 24 away, so this bound catches a swapped or stale source.
const MAX_MEAN_CHANNEL_ERROR = 2;
const MASTER = 'docs/brand/wordmark-pack/source/tokkl-wordmark-clock-master.png';
const FULL = 'docs/brand/tokkl-wordmark-full.png';
const RESIZED = [
  ['packages/web/public/brand/wordmark-260.png', 260],
  ['packages/web/public/brand/wordmark-520.png', 520],
  ['docs/brand/tokkl-wordmark.png', 640],
] as const;
const BORDER = 4;
/** The desktop icons: full-colour RGBA renders of the icon pack's master on a square canvas. */
const KDE_LOGO = 'desktop/kde/package/contents/images/tokkl.png';
const KDE_ICONS = 'desktop/kde/package/icons/';
const KDE_ICON_SIZES = [32, 48, 64, 96, 128, 256];
const GNOME_LOGO = 'desktop/gnome/extension/tokkl.png';
const MACOS_ICONSET = 'desktop/macos/resources/Tokkl.iconset/';
/** The file names `iconutil -c icns` takes, each with its size in pixels: 16 to 512 points at 1x and 2x. */
const MACOS_ICONS = [16, 32, 128, 256, 512].flatMap((points) => [
  [`icon_${points}x${points}.png`, points],
  [`icon_${points}x${points}@2x.png`, points * 2],
] as const);
const DESKTOP_ICONS: [string, number][] = [
  [KDE_LOGO, 96],
  ...KDE_ICON_SIZES.map((size): [string, number] => [`${KDE_ICONS}tokkl-${size}.png`, size]),
  [GNOME_LOGO, 32],
  ...MACOS_ICONS.map(([name, size]): [string, number] => [`${MACOS_ICONSET}${name}`, size]),
];
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PALETTE_PNG = 3;
const RGBA_PNG = 6;

type Png = { width: number; height: number; depth: number; colourType: number; interlace: number; chunks: Map<string, Buffer[]> };

function readPng(path: string): Png {
  const bytes = readFileSync(join(ROOT, path));
  assert.ok(bytes.subarray(0, 8).equals(SIGNATURE), `${path} is not a PNG`);
  const chunks = new Map<string, Buffer[]>();
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), bytes.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  const header = chunks.get('IHDR')?.[0];
  assert.ok(header, `${path} has no IHDR chunk`);
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    depth: header.readUInt8(8),
    colourType: header.readUInt8(9),
    interlace: header.readUInt8(12),
    chunks,
  };
}

/** The value a PNG row filter adds back, from the bytes left (a), above (b) and above-left (c). */
function predict(filter: number, a: number, b: number, c: number) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

/** Every pixel of an 8-bit palette or RGBA PNG without interlacing, as RGBA bytes. */
function rgba(png: Png) {
  assert.deepEqual([png.depth, png.interlace], [8, 0], 'expected an 8-bit PNG without interlacing');
  assert.ok([PALETTE_PNG, RGBA_PNG].includes(png.colourType), 'expected a palette or RGBA PNG');
  const bytesPerPixel = png.colourType === RGBA_PNG ? 4 : 1;
  const palette = png.chunks.get('PLTE')?.[0] ?? Buffer.alloc(0);
  const alpha = png.chunks.get('tRNS')?.[0] ?? Buffer.alloc(0);
  const raw = inflateSync(Buffer.concat(png.chunks.get('IDAT') ?? []));
  const stride = png.width * bytesPerPixel;
  const pixels = new Uint8Array(png.width * png.height * 4);
  let previous = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < png.height; y++) {
    const start = y * (stride + 1);
    const filter = raw.readUInt8(start);
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? row[x - bytesPerPixel]! : 0;
      const b = previous[x]!;
      const c = x >= bytesPerPixel ? previous[x - bytesPerPixel]! : 0;
      row[x] = raw.readUInt8(start + 1 + x) + predict(filter, a, b, c);
    }
    const out = pixels.subarray(y * png.width * 4, (y + 1) * png.width * 4);
    if (png.colourType === RGBA_PNG) {
      out.set(row);
    } else {
      for (let x = 0; x < png.width; x++) {
        const index = row[x]!;
        assert.ok(index * 3 < palette.length, `palette index ${index} is outside the PLTE chunk`);
        out.set(palette.subarray(index * 3, index * 3 + 3), x * 4);
        // Palette entries past the end of tRNS are opaque.
        out[x * 4 + 3] = alpha[index] ?? 255;
      }
    }
    [previous, row] = [row, previous];
  }
  return pixels;
}

/** The smallest box holding every pixel with any opacity. */
function alphaBounds(png: Png) {
  const pixels = rgba(png);
  let [left, top, right, bottom] = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (pixels[(y * png.width + x) * 4 + 3]! > 0) {
        [left, right] = [Math.min(left, x), Math.max(right, x)];
        [top, bottom] = [Math.min(top, y), Math.max(bottom, y)];
      }
    }
  }
  assert.ok(right >= 0, 'the image is fully transparent');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Checks that a PNG is 8-bit, not interlaced, and indexes a palette of at most 256 colours. */
function assertPalettePng(png: Png) {
  assert.deepEqual([png.depth, png.colourType, png.interlace], [8, PALETTE_PNG, 0]);
  const palette = png.chunks.get('PLTE')?.[0];
  assert.ok(palette && palette.length % 3 === 0 && palette.length / 3 <= 256, 'expected a PLTE chunk of at most 256 colours');
}

test('the full-size wordmark is the master trimmed to its alpha bounds plus a 4px border', () => {
  const bounds = alphaBounds(readPng(MASTER));
  const full = readPng(FULL);
  assert.deepEqual([full.width, full.height], [bounds.width + 2 * BORDER, bounds.height + 2 * BORDER]);
});

test("Brand.tsx's WORDMARK_RATIO is the full-size wordmark's height over its width", () => {
  const source = readFileSync(join(ROOT, 'packages/web/src/components/Brand.tsx'), 'utf8');
  const ratio = /^const WORDMARK_RATIO = (\d+) \/ (\d+);$/m.exec(source);
  assert.ok(ratio, 'WORDMARK_RATIO is not written as <height> / <width>');
  const full = readPng(FULL);
  assert.deepEqual([Number(ratio[1]), Number(ratio[2])], [full.height, full.width]);
});

for (const [path, width] of RESIZED) {
  test(`${path} is the crop resized to ${width}px wide`, () => {
    const full = readPng(FULL);
    const resized = readPng(path);
    assert.deepEqual([resized.width, resized.height], [width, Math.round((width * full.height) / full.width)]);
  });
}

for (const path of [FULL, ...RESIZED.map(([resized]) => resized)]) {
  test(`${path} is a 256-colour PNG with transparency and no metadata`, () => {
    const png = readPng(path);
    assertPalettePng(png);
    assert.ok(png.chunks.has('tRNS'), 'expected a tRNS chunk, so the palette keeps its alpha');
    // No tIME, text or other ancillary chunk, so nothing in the file depends on when it was written.
    assert.deepEqual([...png.chunks.keys()].sort(), ['IDAT', 'IEND', 'IHDR', 'PLTE', 'tRNS']);
  });
}

for (const file of QUANTISED_ICONS) {
  test(`${PUBLIC}${file} is the icon pack's ${file} in 256 colours`, () => {
    const source = readPng(`${ICON_PACK}${file}`);
    const icon = readPng(`${PUBLIC}${file}`);
    assert.deepEqual([icon.width, icon.height], [source.width, source.height]);
    const [expected, actual] = [rgba(source), rgba(icon)];
    let error = 0;
    for (let i = 0; i < expected.length; i++) error += Math.abs(expected[i]! - actual[i]!);
    const meanError = error / expected.length;
    assert.ok(meanError <= MAX_MEAN_CHANNEL_ERROR, `mean channel error ${meanError.toFixed(2)} is over ${MAX_MEAN_CHANNEL_ERROR}`);
  });

  test(`${PUBLIC}${file} is a 256-colour PNG with no metadata`, () => {
    const png = readPng(`${PUBLIC}${file}`);
    assertPalettePng(png);
    // tRNS is allowed, since it carries the palette's alpha rather than metadata.
    const chunks = [...png.chunks.keys()].filter((type) => type !== 'tRNS').sort();
    assert.deepEqual(chunks, ['IDAT', 'IEND', 'IHDR', 'PLTE']);
  });
}

test('the macOS iconset holds exactly the ten files iconutil expects', () => {
  const names = readdirSync(join(ROOT, MACOS_ICONSET)).sort();
  assert.deepEqual(names, MACOS_ICONS.map(([name]) => name).sort());
});

test('the KDE widget ships a hicolor icon at each size, and the 96px one is its panel logo', () => {
  const names = readdirSync(join(ROOT, KDE_ICONS)).sort();
  assert.deepEqual(names, KDE_ICON_SIZES.map((size) => `tokkl-${size}.png`).sort());
  assert.ok(readFileSync(join(ROOT, `${KDE_ICONS}tokkl-96.png`)).equals(readFileSync(join(ROOT, KDE_LOGO))));
});

for (const [path, size] of DESKTOP_ICONS) {
  test(`${path} is a ${size}x${size} RGBA PNG with no metadata`, () => {
    const png = readPng(path);
    assert.deepEqual([png.width, png.height], [size, size]);
    assert.deepEqual([png.depth, png.colourType, png.interlace], [8, RGBA_PNG, 0]);
    assert.deepEqual([...png.chunks.keys()].sort(), ['IDAT', 'IEND', 'IHDR']);
  });

  test(`${path} fills its height with the logo, centred across`, () => {
    const bounds = alphaBounds(readPng(path));
    assert.deepEqual([bounds.top, bounds.height], [0, size], 'the art is as tall as the canvas');
    const right = size - bounds.left - bounds.width;
    assert.ok(Math.abs(bounds.left - right) <= 1, `left margin ${bounds.left} and right margin ${right} differ by more than 1px`);
  });
}

for (const [file, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['favicon-48.png', 48], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
  test(`${file} has a transparent background and visible clock artwork`, () => {
    const png = readPng(`${PUBLIC}icons/${file}`);
    assert.deepEqual([png.width, png.height], [size, size]);
    const pixels = rgba(png);
    for (const corner of [0, size - 1, size * (size - 1), size * size - 1]) {
      assert.equal(pixels[corner * 4 + 3], 0);
    }
    assert.ok(pixels.some((value, i) => i % 4 === 3 && value === 255));
    const bounds = alphaBounds(png);
    assert.ok(bounds.height >= size - 2, 'the clock fills the icon height');
    assert.ok(Math.abs(bounds.left - (size - bounds.left - bounds.width)) <= 1);
  });
}

for (const [path, source, channel] of [
  ['desktop/gnome/extension/tokkl-symbolic.symbolic.png', GNOME_LOGO, 0],
  ['desktop/kde/package/contents/images/tokkl-mono-dark.png', KDE_LOGO, 0],
  ['desktop/kde/package/contents/images/tokkl-mono-light.png', KDE_LOGO, 255],
] as const) {
  test(`${path} preserves the clock alpha and uses a single ink`, () => {
    const mono = readPng(path);
    const color = readPng(source);
    assert.deepEqual([mono.width, mono.height], [color.width, color.height]);
    const pixels = rgba(mono);
    const original = rgba(color);
    for (let i = 0; i < pixels.length; i += 4) {
      assert.deepEqual(Array.from(pixels.subarray(i, i + 3)), [channel, channel, channel]);
      assert.equal(pixels[i + 3], original[i + 3]);
    }
  });
}
