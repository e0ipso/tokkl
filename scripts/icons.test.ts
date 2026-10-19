import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

// icons.ts runs ImageMagick when it is imported and writes into the checkout, so these tests read
// the committed files instead and check them against the crop the script asks for. Rerunning the
// script is not tested, because CI has no ImageMagick and only the same build writes the same bytes.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = 'docs/brand/wordmark-pack/source/tokkl-wordmark-clock-master.png';
const FULL = 'docs/brand/tokkl-wordmark-full.png';
const RESIZED = [
  ['packages/web/public/brand/wordmark-260.png', 260],
  ['packages/web/public/brand/wordmark-520.png', 520],
  ['docs/brand/tokkl-wordmark.png', 640],
] as const;
const BORDER = 4;
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

/** The smallest box holding every pixel with any opacity, in an 8-bit RGBA PNG. */
function alphaBounds(png: Png) {
  assert.deepEqual([png.depth, png.colourType, png.interlace], [8, RGBA_PNG, 0], 'expected 8-bit RGBA without interlacing');
  const raw = inflateSync(Buffer.concat(png.chunks.get('IDAT') ?? []));
  const stride = png.width * 4;
  let previous = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  let [left, top, right, bottom] = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++) {
    const start = y * (stride + 1);
    const filter = raw.readUInt8(start);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4]! : 0;
      const b = previous[x]!;
      const c = x >= 4 ? previous[x - 4]! : 0;
      row[x] = raw.readUInt8(start + 1 + x) + predict(filter, a, b, c);
    }
    for (let x = 0; x < png.width; x++) {
      if (row[x * 4 + 3]! > 0) {
        [left, right] = [Math.min(left, x), Math.max(right, x)];
        [top, bottom] = [Math.min(top, y), Math.max(bottom, y)];
      }
    }
    [previous, row] = [row, previous];
  }
  assert.ok(right >= 0, 'the image is fully transparent');
  return { width: right - left + 1, height: bottom - top + 1 };
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
    assert.deepEqual([png.depth, png.colourType, png.interlace], [8, PALETTE_PNG, 0]);
    const palette = png.chunks.get('PLTE')?.[0];
    assert.ok(palette && palette.length % 3 === 0 && palette.length / 3 <= 256, 'expected a PLTE chunk of at most 256 colours');
    assert.ok(png.chunks.has('tRNS'), 'expected a tRNS chunk, so the palette keeps its alpha');
    // No tIME, text or other ancillary chunk, so nothing in the file depends on when it was written.
    assert.deepEqual([...png.chunks.keys()].sort(), ['IDAT', 'IEND', 'IHDR', 'PLTE', 'tRNS']);
  });
}
