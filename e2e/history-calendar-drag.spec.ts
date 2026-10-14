import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  HOUR, dragBy, expectBrowserTimeZone, openCalendar, px, savedTimes, scrollCalendarTo, todayBlock,
} from './history-calendar-tests-helpers.ts';

// The account is in Europe/Madrid (e2e/fixtures.ts). The browser runs in New York, and each "now"
// is late evening there but already the next day in Madrid, so the calendar must follow the
// account's day and clock, not the browser's.
test.use({ timezoneId: 'America/New_York' });

test('moving keeps the duration and resizing stops at the minimum, saved and reloaded in account time', async ({ page, data }) => {
  // Madrid, Wednesday 2026-06-17: 09:00-10:20 and 14:00-15:00 CEST.
  const moved = await data.createEntry({ description: 'Move me', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:20:00Z' });
  const resized = await data.createEntry({ description: 'Resize me', start: '2026-06-17T12:00:00Z', stop: '2026-06-17T13:00:00Z' });
  // 04:00 Wednesday in Madrid, 22:00 Tuesday in New York.
  await page.clock.setFixedTime(new Date('2026-06-17T02:00:00Z'));
  await login(page);
  await expectBrowserTimeZone(page, 'America/New_York');
  await openCalendar(page);

  const move = todayBlock(page, 'Move me');
  await expect(move).toHaveCSS('top', px(9 * 60));
  await expect(move).toHaveCSS('height', px(80));
  await scrollCalendarTo(page, 8);
  await dragBy(page, move, 2);
  await expect.poll(() => savedTimes(page, moved.id))
    .toEqual({ start: '2026-06-17T09:00:00+00:00', stop: '2026-06-17T10:20:00+00:00' });

  // Dragging the bottom edge two hours up, past the start, leaves the 15-minute minimum.
  const resize = todayBlock(page, 'Resize me');
  await expect(resize).toHaveCSS('top', px(14 * 60));
  await scrollCalendarTo(page, 12);
  await dragBy(page, resize.locator('.calendar-resize'), -2);
  await expect.poll(() => savedTimes(page, resized.id))
    .toEqual({ start: '2026-06-17T12:00:00+00:00', stop: '2026-06-17T12:15:00+00:00' });

  await page.reload();
  await expect(move).toHaveCSS('top', px(11 * 60));
  await expect(move).toHaveCSS('height', px(80));
  await expect(move).toHaveAttribute('title', 'Move me, 1:20:00\n11:00 – 12:20');
  await expect(resize).toHaveCSS('top', px(14 * 60));
  await expect(resize).toHaveCSS('height', px(15));
  await expect(resize).toHaveAttribute('title', 'Resize me, 0:15:00\n14:00 – 14:15');
});

test('a move on the Madrid spring clock change lands on the dropped clock slot after reload', async ({ page, data }) => {
  // 01:00-01:30 CET; the clocks jump from 02:00 to 03:00 later that night.
  const entry = await data.createEntry({ description: 'Spring move', start: '2026-03-29T00:00:00Z', stop: '2026-03-29T00:30:00Z' });
  // 04:00 CEST Sunday in Madrid, 22:00 EDT Saturday in New York.
  await page.clock.setFixedTime(new Date('2026-03-29T02:00:00Z'));
  await login(page);
  await expectBrowserTimeZone(page, 'America/New_York');
  await openCalendar(page);

  const block = todayBlock(page, 'Spring move');
  await expect(block).toHaveCSS('top', `${HOUR}px`);
  await scrollCalendarTo(page, 0);
  await dragBy(page, block, 2);
  // Dropped at 03:00 CEST: one hour of elapsed time later, with the same 30-minute duration.
  await expect.poll(() => savedTimes(page, entry.id))
    .toEqual({ start: '2026-03-29T01:00:00+00:00', stop: '2026-03-29T01:30:00+00:00' });

  await page.reload();
  await expect(block).toHaveCSS('top', px(3 * 60));
  await expect(block).toHaveCSS('height', px(30));
  await expect(block).toHaveAttribute('title', 'Spring move, 0:30:00\n03:00 – 03:30');
});

test('a move and a resize on the Madrid autumn clock change follow the clock after reload', async ({ page, data }) => {
  // 00:30-01:00 and 01:00-02:00 CEST; at 03:00 CEST the clocks go back to 02:00 CET.
  const resized = await data.createEntry({ description: 'Autumn resize', start: '2026-10-24T22:30:00Z', stop: '2026-10-24T23:00:00Z' });
  const moved = await data.createEntry({ description: 'Autumn move', start: '2026-10-24T23:00:00Z', stop: '2026-10-25T00:00:00Z' });
  // 04:00 CET Sunday in Madrid, 23:00 EDT Saturday in New York.
  await page.clock.setFixedTime(new Date('2026-10-25T03:00:00Z'));
  await login(page);
  await expectBrowserTimeZone(page, 'America/New_York');
  await openCalendar(page);
  await scrollCalendarTo(page, 0);

  const move = todayBlock(page, 'Autumn move');
  await expect(move).toHaveCSS('top', `${HOUR}px`);
  await dragBy(page, move, 3);
  // Dropped at 04:00 CET, four hours of elapsed time later; the move keeps its hour.
  await expect.poll(() => savedTimes(page, moved.id))
    .toEqual({ start: '2026-10-25T03:00:00+00:00', stop: '2026-10-25T04:00:00+00:00' });

  const resize = todayBlock(page, 'Autumn resize');
  await expect(resize).toHaveCSS('top', px(30));
  await dragBy(page, resize.locator('.calendar-resize'), 2);
  // The stop dropped on the 03:00 CET slot: 3.5 hours of elapsed time, 2.5 hours on the clock.
  await expect.poll(() => savedTimes(page, resized.id))
    .toEqual({ start: '2026-10-24T22:30:00+00:00', stop: '2026-10-25T02:00:00+00:00' });

  await page.reload();
  await expect(move).toHaveCSS('top', px(4 * 60));
  await expect(move).toHaveCSS('height', px(60));
  await expect(move).toHaveAttribute('title', 'Autumn move, 1:00:00\n04:00 – 05:00');
  await expect(resize).toHaveCSS('top', px(30));
  await expect(resize).toHaveCSS('height', px(150));
  await expect(resize).toHaveAttribute('title', 'Autumn resize, 3:30:00\n00:30 – 03:00');
});
