import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** Wide tables scroll inside their own wrapper, never the page. */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page scrolls horizontally').toBeLessThanOrEqual(clientWidth);
}

export async function expectFits(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize()!;
  expect(box, 'the element has no box').not.toBeNull();
  const edges = { left: box!.x, top: box!.y, right: box!.x + box!.width, bottom: box!.y + box!.height };
  expect(edges.left, 'clipped on the left').toBeGreaterThanOrEqual(-0.5);
  expect(edges.top, 'clipped at the top').toBeGreaterThanOrEqual(-0.5);
  expect(edges.right, 'clipped on the right').toBeLessThanOrEqual(viewport.width + 0.5);
  expect(edges.bottom, 'clipped at the bottom').toBeLessThanOrEqual(viewport.height + 0.5);
}

/** Playwright's tap also checks the control gets the touch, so one under the fixed bottom navigation fails. */
export async function tap(locator: Locator): Promise<void> {
  await expectFits(locator);
  await locator.tap();
}

const MORE_PAGES = new Set(['Reports', 'Clients', 'Tags', 'Trash']);

/** The sheet sits inside the navigation. */
export async function openMore(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await tap(nav.getByRole('button', { name: 'More', exact: true }));
  const sheet = nav.getByRole('dialog', { name: 'More' });
  await expect(sheet).toBeVisible();
  // Visible can mean the sheet is still sliding up; wait for its opening animation before checking link bounds.
  await sheet.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  return sheet;
}

/** The sheet closes on navigation, so for its pages the More button carries the active state. */
export async function tapNav(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main' });
  if (MORE_PAGES.has(name)) {
    const sheet = await openMore(page);
    await tap(sheet.getByRole('link', { name, exact: true }));
    await expect(sheet).toBeHidden();
    await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveClass(/\bactive\b/);
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  } else {
    const link = nav.getByRole('link', { name, exact: true });
    await tap(link);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .or(page.getByRole('region', { name: 'Timer' }))
        .first(),
    ).toBeVisible();
  }
  await expectNoPageOverflow(page);
}

/** Tap plain text away from the popover: Chromium snaps a touch to a nearby control. */
export async function tapOutside(text: Locator): Promise<void> {
  await expect(text).toBeVisible();
  await text.tap();
}

export async function tapDownload(page: Page, control: Locator): Promise<{ filename: string; text: string }> {
  const download = page.waitForEvent('download');
  await tap(control);
  const file = await download;
  return { filename: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

export async function tapUpload(
  page: Page,
  control: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await tap(control);
  await (await chooser).setFiles(file);
}
