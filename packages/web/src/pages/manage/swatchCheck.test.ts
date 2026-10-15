import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_COLORS } from '@timetrack/common/colors';
import { checkColor } from './swatchCheck.ts';

const LIGHT = 'var(--swatch-check-light)';
const DARK = 'var(--swatch-check-dark)';

// Independent WCAG 2 contrast so the test does not reuse the helper's own maths.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const tokenHex = { [LIGHT]: '#ffffff', [DARK]: '#0b1026' } as Record<string, string>;

test('checkColor puts the dark check on light swatches and the light check on dark ones', () => {
  assert.equal(checkColor('#ffffff'), DARK);
  assert.equal(checkColor('#f4e7cf'), DARK);
  assert.equal(checkColor('#000000'), LIGHT);
  assert.equal(checkColor('#0b1026'), LIGHT);
});

test('checkColor picks the higher-contrast check for every palette swatch', () => {
  for (const hex of PROJECT_COLORS) {
    const chosen = checkColor(hex);
    const other = chosen === LIGHT ? DARK : LIGHT;
    const chosenRatio = contrast(hex, tokenHex[chosen]!);
    assert.ok(chosenRatio >= contrast(hex, tokenHex[other]!), `${hex} got ${chosen}`);
    // A check mark is a non-text graphic, so it needs 3:1 (WCAG 1.4.11).
    assert.ok(chosenRatio >= 3, `${hex}: ${chosenRatio.toFixed(2)}:1`);
  }
});

test('the worst palette case matches the figure recorded in manage.css', () => {
  const ratios = PROJECT_COLORS.map((hex) => ({ hex, ratio: contrast(hex, tokenHex[checkColor(hex)]!) }));
  const worst = ratios.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  assert.equal(worst.hex, '#9e5bd9');
  assert.equal(checkColor(worst.hex), DARK);
  assert.equal(Math.floor(worst.ratio * 100) / 100, 4.43);
});
