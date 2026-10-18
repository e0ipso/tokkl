import type { CDPSession, Locator, Page } from '@playwright/test';
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

/** The time-entry saves the page sends, in order: POST for a create, PUT for an edit. */
export function entryWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PUT'].includes(request.method()) && /^\/api\/v9\/workspaces\/\d+\/time_entries(\/\d+)?$/.test(path)) {
      writes.push(request.method());
    }
  });
  return writes;
}

/** The start and stop the server has stored for an entry. */
export async function savedTimes(page: Page, id: number): Promise<{ start: string; stop: string | null }> {
  const saved = await (await page.request.get(`/api/v9/me/time_entries/${id}`)).json() as { start: string; stop: string | null };
  return { start: saved.start, stop: saved.stop };
}

/** A point in viewport CSS pixels, where CDP places touches. */
export interface Point {
  x: number;
  y: number;
}

// One CDP session per page. page.touchscreen only taps; CDP touches go through Chromium's input
// pipeline, so they respect touch-action and scroll what is under the finger.
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();

async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point): Promise<void> {
  let session = touchSessions.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    touchSessions.set(page, session);
  }
  // A lifted finger leaves no touch points.
  await (await session).send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });
}

/** Slides a held finger from `from` to `to` in even moves about a frame apart. */
async function touchMoves(page: Page, from: Point, to: Point, steps: number): Promise<void> {
  for (let step = 1; step <= steps; step++) {
    await touch(page, 'touchMove', { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
    await page.waitForTimeout(16);
  }
}

/**
 * Rests the finger for a moment, then lifts it. A finger that lifts while still moving makes
 * Chromium fling, and a touch that lands during the fling only stops it: a tap then fires no click,
 * and a long-press drag scrolls the grid instead, because its touch events can't be cancelled.
 */
async function lift(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await touch(page, 'touchEnd');
}

/**
 * Scrolls the page until the calendar body is in the middle of the screen and returns its box.
 * CDP touches take viewport coordinates, so read the box this way right before a gesture.
 */
export async function calendarBodyBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const body = page.locator('.calendar-body');
  await body.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  return (await body.boundingBox())!;
}

/**
 * A finger that lands on `from`, slides to `to` in `steps` moves (ten by default), rests and lifts.
 * Sideways it is a swipe; up or down it scrolls a `touch-action: pan-y` element like a real finger.
 * The resting finger starts no fling, so the next gesture can follow at once.
 */
export async function touchSwipe(page: Page, from: Point, to: Point, { steps = 10 }: { steps?: number } = {}): Promise<void> {
  await touch(page, 'touchStart', from);
  await touchMoves(page, from, to, steps);
  await lift(page);
}

/**
 * A finger held still on `from` for `holdMs`, longer than the calendar's 500 ms long press, then
 * dragged to `to` in ten moves, rested and lifted. The hold is a real wait: page.clock.setFixedTime
 * leaves timers running, so the app's long-press timer fires during it.
 */
export async function touchLongPressDrag(page: Page, from: Point, to: Point, holdMs = 600): Promise<void> {
  await touch(page, 'touchStart', from);
  await page.waitForTimeout(holdMs);
  await touchMoves(page, from, to, 10);
  await lift(page);
}
