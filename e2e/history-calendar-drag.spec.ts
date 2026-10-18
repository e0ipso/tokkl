import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  HOUR, calendarBodyBox, dragBy, expectBrowserTimeZone, openCalendar, px, savedTimes, scrollCalendarTo, todayBlock,
  touchLongPressDrag, touchSwipe, type Point,
} from './history-calendar-tests-helpers.ts';
import { PHONE } from './mobile-tests-helpers.ts';

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

/** The time-entry saves the page sends, in order: POST for a create, PUT for an edit. */
function entryWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PUT'].includes(request.method()) && /^\/api\/v9\/workspaces\/\d+\/time_entries(\/\d+)?$/.test(path)) {
      writes.push(request.method());
    }
  });
  return writes;
}

/** The middle of `target` in viewport pixels, read once the calendar body is centred on screen. */
async function middleOf(page: Page, target: Locator): Promise<Point> {
  await calendarBodyBox(page);
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Long-presses the middle of `target` (a block, or its resize handle) and drags it vertically by `hours`. */
async function longPressDragBy(page: Page, target: Locator, hours: number): Promise<void> {
  const from = await middleOf(page, target);
  await touchLongPressDrag(page, from, { x: from.x, y: from.y + hours * HOUR });
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('long-press drags create across the spring clock change, move and resize, each saved once and reloaded in account time', async ({ page, data }) => {
    // Madrid, Sunday 2026-03-29, after the clocks jumped from 02:00 to 03:00: 05:00-06:00 and 09:00-09:30 CEST.
    const moved = await data.createEntry({ description: 'Spring move', start: '2026-03-29T03:00:00Z', stop: '2026-03-29T04:00:00Z' });
    const resized = await data.createEntry({ description: 'Spring resize', start: '2026-03-29T07:00:00Z', stop: '2026-03-29T07:30:00Z' });
    // 04:00 CEST Sunday in Madrid, 22:00 EDT Saturday in New York.
    await page.clock.setFixedTime(new Date('2026-03-29T02:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    await openCalendar(page);
    await expect(page.locator('.calendar-column')).toHaveCount(1);
    const writes = entryWrites(page);
    await scrollCalendarTo(page, 0);

    // From the 04:00 slot up to 01:00: three hours on the clock, two of elapsed time. The drag
    // runs upwards because the sticky timer bar covers the top of the grid; a held finger keeps
    // dragging over it.
    await calendarBodyBox(page);
    const column = (await page.locator('.calendar-column').boundingBox())!;
    const x = column.x + column.width / 2;
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/time_entries$/.test(new URL(response.url()).pathname));
    await touchLongPressDrag(page, { x, y: column.y + 4 * HOUR }, { x, y: column.y + HOUR });
    const { id } = await (await created).json() as { id: number };
    expect(await savedTimes(page, id)).toEqual({ start: '2026-03-29T00:00:00+00:00', stop: '2026-03-29T02:00:00+00:00' });
    const editor = page.getByRole('dialog', { name: 'Edit entry' });
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    expect(writes).toEqual(['POST']);

    const move = todayBlock(page, 'Spring move');
    await expect(move).toHaveCSS('top', px(5 * 60));
    await longPressDragBy(page, move, 2);
    await expect.poll(() => savedTimes(page, moved.id))
      .toEqual({ start: '2026-03-29T05:00:00+00:00', stop: '2026-03-29T06:00:00+00:00' });
    expect(writes).toEqual(['POST', 'PUT']);

    const resize = todayBlock(page, 'Spring resize');
    await expect(resize).toHaveCSS('top', px(9 * 60));
    await longPressDragBy(page, resize.locator('.calendar-resize'), 1);
    await expect.poll(() => savedTimes(page, resized.id))
      .toEqual({ start: '2026-03-29T07:00:00+00:00', stop: '2026-03-29T08:30:00+00:00' });
    expect(writes).toEqual(['POST', 'PUT', 'PUT']);

    await page.reload();
    const create = todayBlock(page, '(no description)');
    await expect(create).toHaveCSS('top', px(60));
    await expect(create).toHaveCSS('height', px(3 * 60));
    await expect(create).toHaveAttribute('title', '(no description), 2:00:00\n01:00 – 04:00');
    await expect(move).toHaveCSS('top', px(7 * 60));
    await expect(move).toHaveCSS('height', px(60));
    await expect(move).toHaveAttribute('title', 'Spring move, 1:00:00\n07:00 – 08:00');
    await expect(resize).toHaveCSS('top', px(9 * 60));
    await expect(resize).toHaveCSS('height', px(90));
    await expect(resize).toHaveAttribute('title', 'Spring resize, 1:30:00\n09:00 – 10:30');
  });

  test('a long-press move stays on the shown day on the autumn clock change: a late block stops at midnight and one from the day before cannot move earlier', async ({ page, data }) => {
    // Madrid, Sunday 2026-10-25, when the clocks go back from 03:00 to 02:00: 22:30-23:30 CET, and
    // 23:00 CEST on Saturday to 04:00 CET on Sunday, which Sunday shows cut at midnight. It ends
    // below the top of the grid that the sticky timer bar covers, so a finger can reach it.
    const late = await data.createEntry({ description: 'Late block', start: '2026-10-25T21:30:00Z', stop: '2026-10-25T22:30:00Z' });
    const overnight = await data.createEntry({ description: 'Overnight', start: '2026-10-24T21:00:00Z', stop: '2026-10-25T03:00:00Z' });
    // 04:00 CET Sunday in Madrid, 23:00 EDT Saturday in New York.
    await page.clock.setFixedTime(new Date('2026-10-25T03:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    await openCalendar(page);
    await expect(page.locator('.calendar-column')).toHaveCount(1);
    const writes = entryWrites(page);

    // Three hours down would end it at 02:30 on Monday; it stops at midnight and keeps its hour.
    const lateBlock = todayBlock(page, 'Late block');
    await expect(lateBlock).toHaveCSS('top', px(22.5 * 60));
    await scrollCalendarTo(page, 24);
    await longPressDragBy(page, lateBlock, 3);
    await expect.poll(() => savedTimes(page, late.id))
      .toEqual({ start: '2026-10-25T22:00:00+00:00', stop: '2026-10-25T23:00:00+00:00' });
    expect(writes).toEqual(['PUT']);

    // Its top is already Sunday's midnight, so dragging it up moves nothing, and letting go of a
    // block that did not move opens the editor, as a click does.
    const overnightBlock = todayBlock(page, 'Overnight');
    await expect(overnightBlock).toHaveCSS('top', '0px');
    await scrollCalendarTo(page, 0);
    await longPressDragBy(page, overnightBlock, -2);
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
    expect(writes).toEqual(['PUT']);
    expect(await savedTimes(page, overnight.id)).toEqual({ start: '2026-10-24T21:00:00+00:00', stop: '2026-10-25T03:00:00+00:00' });

    await page.reload();
    await expect(lateBlock).toHaveCSS('top', px(23 * 60));
    await expect(lateBlock).toHaveCSS('height', px(60));
    await expect(lateBlock).toHaveAttribute('title', 'Late block, 1:00:00\n23:00 – 00:00');
    await expect(overnightBlock).toHaveCSS('top', '0px');
    await expect(overnightBlock).toHaveCSS('height', px(4 * 60));
  });

  test('a plain vertical swipe scrolls the day view and creates nothing', async ({ page, data }) => {
    // 04:00 Wednesday in Madrid, 22:00 Tuesday in New York.
    await page.clock.setFixedTime(new Date('2026-06-17T02:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    await openCalendar(page);
    await expect(page.locator('.calendar-range')).toHaveText('Wed, 17 Jun');
    const writes = entryWrites(page);
    const body = page.locator('.calendar-body');
    await scrollCalendarTo(page, 2);
    const before = await body.evaluate((element) => element.scrollTop);

    // Up the empty column, not the hour gutter, and for longer than the long press, so the
    // movement has to cancel the hold before it turns into a new entry; lifting the finger is too late.
    const box = await calendarBodyBox(page);
    const column = (await page.locator('.calendar-column').boundingBox())!;
    const x = column.x + column.width / 2;
    await touchSwipe(page, { x, y: box.y + box.height * 0.75 }, { x, y: box.y + box.height * 0.25 }, { steps: 40 });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(before + 2 * HOUR);
    await expect(page.locator('.calendar-ghost')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toHaveCount(0);
    await expect(page.locator('.calendar-range')).toHaveText('Wed, 17 Jun');
    expect(writes).toEqual([]);
    expect(await data.entries()).toEqual([]);
  });

  test('a tap on a block opens its editor without saving', async ({ page, data }) => {
    // Madrid, Wednesday 2026-06-17: 09:00-10:00 CEST.
    await data.createEntry({ description: 'Tapped block', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z' });
    // 04:00 Wednesday in Madrid, 22:00 Tuesday in New York.
    await page.clock.setFixedTime(new Date('2026-06-17T02:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    await openCalendar(page);
    const writes = entryWrites(page);
    await scrollCalendarTo(page, 7);

    // The finger lifts long before the long press, so this is a tap, which edits like a click.
    const point = await middleOf(page, todayBlock(page, 'Tapped block'));
    await page.touchscreen.tap(point.x, point.y);
    const editor = page.getByRole('dialog', { name: 'Edit entry' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Description')).toHaveValue('Tapped block');
    expect(writes).toEqual([]);
  });
});
