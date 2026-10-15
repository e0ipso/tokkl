import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/**
 * Pixel height of one hour on the week calendar (HOUR_HEIGHT in
 * packages/web/src/components/WeekCalendar.tsx).
 */
export const HOUR = 48;

/** Pixels for a number of minutes on the week calendar. */
export function px(minutes: number): string {
  return `${(minutes / 60) * HOUR}px`;
}

/** Fails early if the browser context is not running in the time zone the scenario relies on. */
export async function expectBrowserTimeZone(page: Page, timeZone: string): Promise<void> {
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timeZone);
}

/** Switches the timer page to the calendar and waits until the choice is saved, so a reload keeps it. */
export async function openCalendar(page: Page): Promise<void> {
  const saved = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v9/me/preferences');
  await page.getByRole('button', { name: 'Calendar' }).click();
  await saved;
  await expect(page.locator('.calendar-column.today')).toBeVisible();
}

/** The block of an entry in the column for today. */
export function todayBlock(page: Page, description: string): Locator {
  return page.locator('.calendar-column.today .calendar-block', { hasText: description });
}

/** Scrolls the calendar so that `hour` is at the top of the visible area. */
export async function scrollCalendarTo(page: Page, hour: number): Promise<void> {
  await page.locator('.calendar-body').evaluate((el, top) => el.scrollTo({ top }), hour * HOUR);
}

/** Presses on `target` (a block, or its resize handle) and drags it vertically by `hours`. */
export async function dragBy(page: Page, target: Locator, hours: number): Promise<void> {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(5, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + hours * HOUR, { steps: 8 });
  await page.mouse.up();
}

/** The start and stop the server has stored for an entry. */
export async function savedTimes(page: Page, id: number): Promise<{ start: string; stop: string | null }> {
  const saved = await (await page.request.get(`/api/v9/me/time_entries/${id}`)).json() as { start: string; stop: string | null };
  return { start: saved.start, stop: saved.stop };
}
