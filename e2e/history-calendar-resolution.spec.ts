import type { Page } from '@playwright/test';
import { expect, test } from './admin-tests-helpers.ts';
import { login } from './helpers.ts';
import { dragBy, openCalendar, savedTimes, scrollCalendarTo, todayBlock } from './history-calendar-tests-helpers.ts';

// The time resolution belongs to the whole server, so these scenarios run in the instance project
// and the `instance` fixture puts the settings back after each one. The calendar drags in steps of
// the smallest multiple of the resolution that is at least 15 minutes, and a dropped boundary lands
// on the resolution grid, so the server stores the span the drag showed.

const MINUTE = 60_000;
// 09:00 on Wednesday 2026-06-17 in Madrid (CEST, UTC+2), the account's zone.
const NINE = Date.parse('2026-06-17T07:00:00Z');

/** `minutes` after 09:00 the way the web app sends it. */
function sent(minutes: number): string {
  return new Date(NINE + minutes * MINUTE).toISOString();
}

/** `minutes` after 09:00 the way the API returns it. */
function at(minutes: number): string {
  return sent(minutes).replace('.000Z', '+00:00');
}

// A block from 09:00 to `end`, and the next entry on the grid at `next`, in minutes after 09:00.
// The drag travels a little past the gap, less than half a step, and rounds to whole steps.
const RESIZES = [
  { resolution: 5, step: 15, end: 15, next: 30, travel: 20, joined: ['09:00 – 09:30', '09:30 – 10:30'] },
  { resolution: 12, step: 24, end: 12, next: 36, travel: 28, joined: ['09:00 – 09:36', '09:36 – 10:36'] },
  { resolution: 20, step: 20, end: 20, next: 60, travel: 45, joined: ['09:00 – 10:00', '10:00 – 11:00'] },
];

for (const { resolution, step, end, next, travel, joined } of RESIZES) {
  test(`at a ${resolution}-minute resolution the bottom edge drags in ${step}-minute steps onto the next entry's start`, async ({ page, data }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: resolution });
    const before = await data.createEntry({ description: 'Before', start: at(0), stop: at(end) });
    const after = await data.createEntry({ description: 'After', start: at(next), stop: at(next + 60) });
    await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
    await login(page);
    await openCalendar(page);
    await scrollCalendarTo(page, 8);

    await dragBy(page, todayBlock(page, 'Before').locator('.calendar-resize'), travel / 60);
    await expect.poll(() => savedTimes(page, before.id)).toEqual({ start: at(0), stop: at(next) });
    expect(await savedTimes(page, after.id)).toEqual({ start: at(next), stop: at(next + 60) });

    await page.reload();
    await expect(todayBlock(page, 'Before')).toHaveAttribute('title', new RegExp(`\\n${joined[0]}$`));
    await expect(todayBlock(page, 'After')).toHaveAttribute('title', new RegExp(`\\n${joined[1]}$`));
  });
}

/** The body of the next PUT the page sends for entry `id`. */
async function sentUpdate(page: Page, id: number): Promise<{ start?: string; stop?: string }> {
  const request = await page.waitForRequest((request) =>
    request.method() === 'PUT' && new URL(request.url()).pathname.endsWith(`/time_entries/${id}`));
  return request.postDataJSON() as { start?: string; stop?: string };
}

test('at a 12-minute resolution a moved or resized entry with an off-grid start lands on the grid', async ({ page, data }) => {
  // Saved at a 1-minute resolution, so they keep times off the 12-minute grid, as imports do.
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const moved = await data.createEntry({ description: 'Moved', start: at(7), stop: at(50) });
  const resized = await data.createEntry({ description: 'Resized', start: at(127), stop: at(170) });
  await data.saveInstanceSettings({ time_resolution_minutes: 12 });
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  await login(page);
  await openCalendar(page);
  await scrollCalendarTo(page, 8);

  // Two 24-minute steps take 09:07 to 09:55, and the start drops on the nearest grid point, 10:00.
  // At this resolution the entry stores as 09:12 to 09:48, so it moves as those 36 minutes.
  const move = sentUpdate(page, moved.id);
  await dragBy(page, todayBlock(page, 'Moved'), 48 / 60);
  expect(await move).toEqual({ start: sent(60), stop: sent(96) });
  await expect.poll(() => savedTimes(page, moved.id)).toEqual({ start: at(60), stop: at(96) });

  // One step takes the 11:50 stop to 12:14, which drops on 12:12. Only the stop is sent; the server
  // moves the 11:07 start to its nearest grid point, 11:12.
  const resize = sentUpdate(page, resized.id);
  await dragBy(page, todayBlock(page, 'Resized').locator('.calendar-resize'), 24 / 60);
  expect(await resize).toEqual({ stop: sent(192) });
  await expect.poll(() => savedTimes(page, resized.id)).toEqual({ start: at(132), stop: at(192) });

  await page.reload();
  await expect(todayBlock(page, 'Moved')).toHaveAttribute('title', 'Moved, 0:36:00\n10:00 – 10:36');
  await expect(todayBlock(page, 'Resized')).toHaveAttribute('title', 'Resized, 1:00:00\n11:12 – 12:12');
});
