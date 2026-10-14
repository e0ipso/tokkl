import type { Locator, Page } from '@playwright/test';
import { expect, test, type TestData } from './fixtures.ts';
import { login } from './helpers.ts';

// TT-0072: the prefers-reduced-motion block at the end of styles.css stops the running dot's
// pulse and the report fades, and keeps the dot solid.

// Computed durations come back in seconds, so 0.01ms reads as "1e-05s".
const LIMIT_MS = 0.01 + 1e-9;

/** The longest entry of a computed time list such as "1e-05s, 0.2s", in milliseconds. */
function longestMs(value: string): number {
  return Math.max(...value.split(',').map((part) => {
    const text = part.trim();
    return text.endsWith('ms') ? parseFloat(text) : parseFloat(text) * 1000;
  }));
}

async function startTimer(page: Page) {
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Motion check');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
}

function dotState(dot: Locator) {
  return dot.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      iterations: style.animationIterationCount,
      duration: style.animationDuration,
      opacity: style.opacity,
      running: el.getAnimations().filter((animation) => animation.playState === 'running').length,
    };
  });
}

const transitionDuration = (target: Locator) => target.evaluate((el) => getComputedStyle(el).transitionDuration);

/** Opens the summary report for a week with one entry, so the chart renders. */
async function openReport(page: Page, data: TestData) {
  await data.createEntry({ description: 'Charted', start: '2026-01-07T09:00:00Z', stop: '2026-01-07T11:00:00Z' });
  await login(page);
  await page.goto('/reports?from=2026-01-05&to=2026-01-11');
  await expect(page.locator('.series-chart')).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`under reduced motion the running dot is solid and still in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
    await login(page);
    expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
    await startTimer(page);

    const dot = page.locator('.running-dot');
    await expect(dot).toBeVisible();
    // An infinite pulse never settles, so polling until nothing runs cannot pass by accident.
    await expect.poll(async () => (await dotState(dot)).running).toBe(0);
    const state = await dotState(dot);
    expect(state.iterations).toBe('1');
    expect(longestMs(state.duration)).toBeLessThanOrEqual(LIMIT_MS);
    expect(state.opacity).toBe('1');

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return [root.getPropertyValue('--duration-fast').trim(), root.getPropertyValue('--duration-base').trim()];
    });
    expect(tokens.map(longestMs)).toEqual([0, 0]);
  });
}

test('under reduced motion the report chart and dimmed tables change without a transition', async ({ page, data }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReport(page, data);
  expect(longestMs(await transitionDuration(page.locator('.series-chart')))).toBeLessThanOrEqual(LIMIT_MS);

  // .reports .is-dimmed only applies while a report refetches; set the class to read the rule.
  const table = page.locator('.reports .table-wrap').first();
  await table.evaluate((el) => el.classList.add('is-dimmed'));
  expect(longestMs(await transitionDuration(table))).toBeLessThanOrEqual(LIMIT_MS);
});

test('without the preference the dot pulses and the report still fades', async ({ page, data }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReport(page, data);
  expect(await transitionDuration(page.locator('.series-chart'))).toBe('0.15s');

  await page.goto('/');
  await startTimer(page);
  const state = await dotState(page.locator('.running-dot'));
  expect(state.iterations).toBe('infinite');
  expect(state.duration).toBe('1.6s');
  expect(state.running).toBe(1);
});
