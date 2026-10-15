import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { contrast, login } from './helpers.ts';

// TT-0071: keyboard focus shows a 2px ring on the timer description, the "Project" button of an
// entry without a project, and the reports description search, with 3:1 contrast in both themes.

/** Presses Tab until the target has focus, so :focus-visible comes from real keyboard use. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the target within ${limit} presses`);
}

interface Ring { width: string; style: string; color: string; behind: string }

/** The outline of an element and the first opaque background behind it. */
function ringOf(target: Locator): Promise<Ring> {
  return target.evaluate((el) => {
    const style = getComputedStyle(el);
    let behind = 'rgb(255, 255, 255)';
    for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (!/^rgba\(.*,\s*0\)$/.test(background) && background !== 'transparent') { behind = background; break; }
    }
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, behind };
  });
}

async function expectRing(target: Locator) {
  const ring = await ringOf(target);
  expect(ring.width).toBe('2px');
  expect(ring.style).toBe('solid');
  expect(contrast(ring.color, ring.behind)).toBeGreaterThanOrEqual(3);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test('the timer description shows the focus ring', async ({ page }) => {
      await login(page);
      expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
      const description = page.getByRole('region', { name: 'Timer' }).getByLabel('Description');
      await tabTo(page, description);
      await expectRing(description);
    });

    test('the Project button of an entry without a project shows its label and ring', async ({ page, data }) => {
      const now = Date.now();
      await data.createEntry({
        description: 'No project yet',
        start: new Date(now - 3 * 3_600_000).toISOString(),
        stop: new Date(now - 2 * 3_600_000).toISOString(),
      });
      await login(page);
      const button = page.locator('.entry-line').first().getByRole('button', { name: 'Project' });
      const label = button.locator('.add-project');
      await expect(label).toHaveCSS('opacity', '0');
      await tabTo(page, button);
      await expect(label).toHaveCSS('opacity', '1');
      await expectRing(button);
    });

    test('the reports description search rings its wrapper', async ({ page }) => {
      await login(page);
      await page.goto('/reports');
      const search = page.getByLabel('Filter by description');
      await tabTo(page, search);
      await expectRing(page.locator('.search-box', { has: search }));
    });
  });
}
