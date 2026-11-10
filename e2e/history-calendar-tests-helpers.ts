import type { CDPSession, Locator, Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** HOUR_HEIGHT in packages/web/src/lib/calendarLayout.ts. */
export const HOUR = 48;

export function px(minutes: number): string {
  return `${(minutes / 60) * HOUR}px`;
}

export async function expectBrowserTimeZone(page: Page, timeZone: string): Promise<void> {
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timeZone);
}

export async function openCalendar(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v9/me/preferences',
  );
  await page.getByRole('button', { name: 'Calendar' }).click();
  await saved;
  await expect(page.locator('.calendar-column.today')).toBeVisible();
}

export function todayBlock(page: Page, description: string): Locator {
  return page.locator('.calendar-column.today .calendar-block', { hasText: description });
}

export async function scrollCalendarTo(page: Page, hour: number): Promise<void> {
  await page.locator('.calendar-body').evaluate((el, top) => el.scrollTo({ top }), hour * HOUR);
}

export async function dragBy(page: Page, target: Locator, hours: number): Promise<void> {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(5, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + hours * HOUR, { steps: 8 });
  await page.mouse.up();
}

export function entryWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PUT'].includes(request.method()) && /^\/api\/v9\/workspaces\/\d+\/time_entries(\/\d+)?$/.test(path)) {
      writes.push(request.method());
    }
  });
  return writes;
}

export async function savedTimes(page: Page, id: number): Promise<{ start: string; stop: string | null }> {
  const saved = (await (await page.request.get(`/api/v9/me/time_entries/${id}`)).json()) as {
    start: string;
    stop: string | null;
  };
  return { start: saved.start, stop: saved.stop };
}

export interface Point {
  x: number;
  y: number;
}

// page.touchscreen only taps; CDP touches go through Chromium's input pipeline and respect touch-action.
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();

async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point): Promise<void> {
  let session = touchSessions.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    touchSessions.set(page, session);
  }
  await (
    await session
  ).send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });
}

async function touchMoves(page: Page, from: Point, to: Point, steps: number): Promise<void> {
  for (let step = 1; step <= steps; step++) {
    await touch(page, 'touchMove', {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await page.waitForTimeout(16);
  }
}

/** A finger lifted while moving makes Chromium fling, and a touch during a fling only stops it. */
async function lift(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await touch(page, 'touchEnd');
}

/** CDP touches take viewport coordinates, so read the box right before a gesture. */
export async function calendarBodyBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const body = page.locator('.calendar-body');
  await body.evaluate(element => element.scrollIntoView({ block: 'center' }));
  return (await body.boundingBox())!;
}

/** The resting finger starts no fling, so the next gesture can follow at once. */
export async function touchSwipe(
  page: Page,
  from: Point,
  to: Point,
  { steps = 10 }: { steps?: number } = {},
): Promise<void> {
  await touch(page, 'touchStart', from);
  await touchMoves(page, from, to, steps);
  await lift(page);
}

/** The hold is a real wait: page.clock.setFixedTime leaves timers running, so the long-press timer fires. */
export async function touchLongPressDrag(page: Page, from: Point, to: Point, holdMs = 600): Promise<void> {
  await touch(page, 'touchStart', from);
  await page.waitForTimeout(holdMs);
  await touchMoves(page, from, to, 10);
  await lift(page);
}
