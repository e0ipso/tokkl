import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';

/** The phone settings e2e/mobile.spec.ts uses. Pass to `test.use` in each mobile spec. */
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** The page itself never scrolls sideways; wide tables scroll inside their own wrapper. */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page scrolls horizontally').toBeLessThanOrEqual(clientWidth);
}

/** The element lies wholly inside the viewport once scrolled to, so nothing of it is cut off. */
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

/**
 * Taps a control after checking it fits the screen. Playwright's tap also checks that the control
 * itself receives the touch, so a control under the fixed bottom navigation fails here.
 */
export async function tap(locator: Locator): Promise<void> {
  await expectFits(locator);
  await locator.tap();
}

/** Taps a link in the bottom navigation and waits for its page. */
export async function tapNav(page: Page, name: string): Promise<void> {
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
  await tap(link);
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 }).or(page.getByRole('region', { name: 'Timer' })).first()).toBeVisible();
  await expectNoPageOverflow(page);
}

/**
 * Closes an open popover the way a finger does, with a tap on plain text such as a heading. Pick
 * text away from the popover: Chromium snaps a touch to a nearby control, so a tap on bare margin
 * next to the popover lands inside it.
 */
export async function tapOutside(text: Locator): Promise<void> {
  await expect(text).toBeVisible();
  await text.tap();
}

/** Taps a control that downloads a file and returns the file's name and text. */
export async function tapDownload(page: Page, control: Locator): Promise<{ filename: string; text: string }> {
  const download = page.waitForEvent('download');
  await tap(control);
  const file = await download;
  return { filename: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

/** Taps a file-picking control and answers the chooser it opens. */
export async function tapUpload(page: Page, control: Locator, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await tap(control);
  await (await chooser).setFiles(file);
}
