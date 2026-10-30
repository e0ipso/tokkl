import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';
import { openCalendar } from './history-calendar-tests-helpers.ts';
import { TimerApi } from './timer-tests-helpers.ts';
import { calendarBodyBox, dragBy, entryWrites, expectBrowserTimeZone, px, savedTimes, scrollCalendarTo, todayBlock, touchSwipe } from './history-calendar-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, tap } from './mobile-tests-helpers.ts';
// Its `api` fixture puts the account's first weekday back after each scenario.
import { test as testWithSettings } from './report-tests-helpers.ts';

test('calendar view shows entries and creates one by dragging', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Calendar' }).click();
  const todayColumn = page.locator('.calendar-column.today');
  await expect(todayColumn).toBeVisible();
  const before = await page.locator('.calendar-block:not(.calendar-ghost)').count();

  const box = (await todayColumn.boundingBox())!;
  const body = page.locator('.calendar-body');
  await body.evaluate((el) => el.scrollTo({ top: 8 * 48 }));
  const bodyBox = (await body.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, bodyBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, bodyBox.y + 80, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
  await page.getByRole('dialog').getByLabel('Description').fill('Planning from calendar');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.calendar-block', { hasText: 'Planning from calendar' })).toBeVisible();
  expect(await page.locator('.calendar-block:not(.calendar-ghost)').count()).toBe(before + 1);
  await page.screenshot({ path: 'test-results/calendar.png' });

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('input[value="Planning from calendar"]')).toBeVisible();
});

// Each Madrid clock change: the browser's today, an entry at 10:00-11:00 local, and an entry that
// a two-hour drag moves into (or across) the changed hour.
const CLOCK_CHANGES = [
  {
    name: 'autumn',
    now: '2025-10-26T11:00:00Z',
    morning: { start: '2025-10-26T09:00:00Z', stop: '2025-10-26T10:00:00Z' },
    // 0:30-1:00 CEST, dropped at 2:30, which happens twice: the later 2:30 (CET) wins.
    night: { start: '2025-10-25T22:30:00Z', stop: '2025-10-25T23:00:00Z', top: '24px' },
    dropped: { start: '2025-10-26T01:30:00+00:00', stop: '2025-10-26T02:00:00+00:00' },
  },
  {
    name: 'spring',
    now: '2026-03-29T11:00:00Z',
    morning: { start: '2026-03-29T08:00:00Z', stop: '2026-03-29T09:00:00Z' },
    // 1:00-1:30 CET, dropped at 3:00 CEST, one hour of elapsed time later.
    night: { start: '2026-03-29T00:00:00Z', stop: '2026-03-29T00:30:00Z', top: '48px' },
    dropped: { start: '2026-03-29T01:00:00+00:00', stop: '2026-03-29T01:30:00+00:00' },
  },
];

for (const change of CLOCK_CHANGES) {
  test(`calendar places and drags entries by local clock time on the ${change.name} clock change`, async ({ page, data }) => {
    await data.createEntry({ description: 'Morning block', ...change.morning });
    const night = await data.createEntry({ description: 'Night block', start: change.night.start, stop: change.night.stop });
    await page.clock.setFixedTime(new Date(change.now));
    await login(page);
    await page.getByRole('button', { name: 'Calendar' }).click();
    const morning = page.locator('.calendar-column.today .calendar-block', { hasText: 'Morning block' });
    await expect(morning).toHaveCSS('top', `${10 * 48}px`);
    await expect(morning).toHaveCSS('height', '48px');

    const block = page.locator('.calendar-column.today .calendar-block', { hasText: 'Night block' });
    await expect(block).toHaveCSS('top', change.night.top);
    await page.locator('.calendar-body').evaluate((el) => el.scrollTo({ top: 0 }));
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 5 + 2 * 48, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const saved = await (await page.request.get(`/api/v9/me/time_entries/${night.id}`)).json();
      return { start: saved.start, stop: saved.stop };
    }).toEqual(change.dropped);
  });
}

// Every block is a group named "description, project, duration", and a block under 45
// minutes shows the project after the description on its one line.
test('calendar blocks are named by description, project and duration, and short blocks show the project', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  await login(page);
  const api = await EntityApi.open(page);
  const project = await api.createProject({ name: 'Website' });
  // Madrid, Wednesday 2026-06-17: 09:00-10:00, 12:00-12:30 and 14:00-14:15 CEST.
  await api.createEntry({ description: 'Homepage copy', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z', project_id: project.id });
  await api.createEntry({ description: 'Quick call', start: '2026-06-17T10:00:00Z', stop: '2026-06-17T10:30:00Z', project_id: project.id });
  await api.createEntry({ description: 'Inbox', start: '2026-06-17T12:00:00Z', stop: '2026-06-17T12:15:00Z' });
  await page.reload();
  await openCalendar(page);
  const today = page.locator('.calendar-column.today');

  const long = today.getByRole('group', { name: 'Homepage copy, Website, 1:00:00', exact: true });
  await expect(long).toHaveAttribute('title', 'Homepage copy, Website, 1:00:00\n09:00 – 10:00');
  await expect(long.locator('strong')).toHaveText('Homepage copy');
  await expect(long).toContainText('Website · 1:00:00');

  const short = today.getByRole('group', { name: 'Quick call, Website, 0:30:00', exact: true });
  await expect(short.locator('.calendar-block-line')).toHaveText('Quick call · Website');

  const plain = today.getByRole('group', { name: 'Inbox, 0:15:00', exact: true });
  await expect(plain.locator('.calendar-block-line')).toHaveText('Inbox');
});

// A zero-length entry (stored before the API refused spans that round to zero, or a short timer
// restored from the trash) can sit where the next entry starts. Lanes follow the stored spans, so
// the pair shares one lane with the thin marker above its successor. Spans that overlap still sit
// side by side.
test('a zero-length entry shares its successor\'s lane and both stay clickable, while overlapping entries split lanes', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid, Wednesday 2026-06-17 (CEST): the marker at 09:00, then two overlapping entries from 11:00.
  await data.createZeroLengthEntry('Switch', '2026-06-17T07:00:00Z');
  await data.createEntry({ description: 'Follow-up', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z' });
  await data.createEntry({ description: 'Early', start: '2026-06-17T09:00:00Z', stop: '2026-06-17T10:00:00Z' });
  await data.createEntry({ description: 'Late', start: '2026-06-17T09:30:00Z', stop: '2026-06-17T10:30:00Z' });
  await login(page);
  await openCalendar(page);
  await scrollCalendarTo(page, 8);

  // Blocks are laid out inside the column's 1px left border.
  const inner = (await page.locator('.calendar-column.today').boundingBox())!.width - 1;
  const marker = todayBlock(page, 'Switch');
  const successor = todayBlock(page, 'Follow-up');
  await expect(marker).toHaveCSS('top', px(9 * 60));
  await expect(marker).toHaveCSS('height', '6px');
  await expect(successor).toHaveCSS('height', px(60));
  const markerBox = (await marker.boundingBox())!;
  const successorBox = (await successor.boundingBox())!;
  expect(markerBox.x).toBeCloseTo(successorBox.x, 1);
  expect(markerBox.width).toBeCloseTo(successorBox.width, 1);
  expect(successorBox.width).toBeCloseTo(inner - 4, 1);

  // Playwright clicks only where the block is the topmost element, so each click proves the
  // marker is not covered by the entry it touches.
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await marker.click();
  await expect(editor.getByLabel('Description')).toHaveValue('Switch');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await successor.click();
  await expect(editor.getByLabel('Description')).toHaveValue('Follow-up');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  const early = (await todayBlock(page, 'Early').boundingBox())!;
  const late = (await todayBlock(page, 'Late').boundingBox())!;
  expect(early.width).toBeCloseTo(inner / 2 - 4, 1);
  expect(late.width).toBeCloseTo(early.width, 1);
  expect(late.x).toBeGreaterThanOrEqual(early.x + early.width);
});

// Several zero-length entries can share one grid point. They sit side by side so each stays
// clickable, and the entry that starts there keeps its full width.
test('zero-length entries at one instant sit side by side and each opens its own editor', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid, Wednesday 2026-06-17 (CEST): two markers at 09:00, then an entry that starts there.
  await data.createZeroLengthEntry('Switch one', '2026-06-17T07:00:00Z');
  await data.createZeroLengthEntry('Switch two', '2026-06-17T07:00:00Z');
  await data.createEntry({ description: 'Follow-up', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z' });
  await login(page);
  await openCalendar(page);
  await scrollCalendarTo(page, 8);

  // Blocks are laid out inside the column's 1px left border.
  const inner = (await page.locator('.calendar-column.today').boundingBox())!.width - 1;
  const one = todayBlock(page, 'Switch one');
  const two = todayBlock(page, 'Switch two');
  await expect(one).toHaveCSS('top', px(9 * 60));
  await expect(two).toHaveCSS('top', px(9 * 60));
  const oneBox = (await one.boundingBox())!;
  const twoBox = (await two.boundingBox())!;
  const successorBox = (await todayBlock(page, 'Follow-up').boundingBox())!;
  expect(oneBox.width).toBeCloseTo(inner / 2 - 4, 1);
  expect(twoBox.width).toBeCloseTo(oneBox.width, 1);
  // Side by side, in either order.
  expect(Math.abs(twoBox.x - oneBox.x)).toBeGreaterThanOrEqual(oneBox.width);
  expect(successorBox.width).toBeCloseTo(inner - 4, 1);

  // Playwright clicks only where the block is the topmost element.
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  for (const [block, description] of [[one, 'Switch one'], [two, 'Switch two']] as const) {
    await block.click();
    await expect(editor.getByLabel('Description')).toHaveValue(description);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  }
});

// A zero-length entry at local midnight belongs to the day that starts at that midnight, and an
// entry that ends at midnight stays on its own day.
test('a zero-length entry at local midnight is drawn on the day it starts and opens its editor', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid midnight between Tuesday 2026-06-16 and Wednesday 2026-06-17 (CEST) is 22:00Z.
  await data.createZeroLengthEntry('Midnight switch', '2026-06-16T22:00:00Z');
  await data.createEntry({ description: 'Ends at midnight', start: '2026-06-16T21:00:00Z', stop: '2026-06-16T22:00:00Z' });
  await login(page);
  await openCalendar(page);
  await scrollCalendarTo(page, 0);

  const marker = todayBlock(page, 'Midnight switch');
  await expect(marker).toHaveCSS('top', '0px');
  await expect(marker).toHaveCSS('height', '6px');
  await expect(page.locator('.calendar-block', { hasText: 'Midnight switch' })).toHaveCount(1);
  await expect(page.locator('.calendar-block', { hasText: 'Ends at midnight' })).toHaveCount(1);
  await expect(todayBlock(page, 'Ends at midnight')).toHaveCount(0);

  await marker.click();
  await expect(page.getByRole('dialog', { name: 'Edit entry' }).getByLabel('Description')).toHaveValue('Midnight switch');
});

// A zero-length entry is a thin bar over a short entry that starts at the same instant. The bar
// stays on top and the short entry is drawn tall enough to show below it, so each opens its own editor.
test('a zero-length entry and a short entry starting with it both open their own editor', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid, Wednesday 2026-06-17 (CEST): 09:00 to 09:00 and 09:00 to 09:05, 11:00 to 11:00 and 11:00 to 11:10.
  await data.createZeroLengthEntry('Switch nine', '2026-06-17T07:00:00Z');
  await data.createEntry({ description: 'Short five', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T07:05:00Z' });
  await data.createZeroLengthEntry('Switch eleven', '2026-06-17T09:00:00Z');
  await data.createEntry({ description: 'Short ten', start: '2026-06-17T09:00:00Z', stop: '2026-06-17T09:10:00Z' });
  await login(page);
  await openCalendar(page);
  await scrollCalendarTo(page, 8);

  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  for (const [marker, short] of [['Switch nine', 'Short five'], ['Switch eleven', 'Short ten']] as const) {
    const markerBlock = todayBlock(page, marker);
    const shortBlock = todayBlock(page, short);
    await expect(markerBlock).toHaveCSS('height', '6px');
    const markerBox = (await markerBlock.boundingBox())!;
    const shortBox = (await shortBlock.boundingBox())!;
    expect(shortBox.y).toBeCloseTo(markerBox.y, 1);

    // Playwright clicks only where the block is the topmost element.
    await markerBlock.click();
    await expect(editor.getByLabel('Description')).toHaveValue(marker);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    // At least 6px of the short entry show below the marker, and the click lands there.
    expect(shortBox.y + shortBox.height).toBeGreaterThanOrEqual(markerBox.y + markerBox.height + 6);
    await shortBlock.click({ position: { x: shortBox.width / 2, y: shortBox.height - 3 } });
    await expect(editor.getByLabel('Description')).toHaveValue(short);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  }
});

// The running block and the now line use --state-running, the running block is dashed so
// colour is not its only mark, and only today's day head is a filled badge: the timer's orange
// sticker inverted, so the mark is a shape as well as a colour.
test('the running block and the now line use the running colour, and today is a filled badge', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Live work');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await openCalendar(page);

  /** The computed colour of a token, read through a throwaway element. */
  const token = (property: string) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, property);
  const running = await token('--state-running');
  const block = page.locator('.calendar-column.today .calendar-block.running');
  await expect(block).toHaveCount(1);
  await expect(block).toHaveCSS('border-top-style', 'dashed');
  await expect(block).toHaveCSS('border-top-color', running);
  await expect(page.locator('.calendar-column.today .calendar-now')).toHaveCSS('background-color', running);

  const badge = page.locator('.calendar-day-head.today span');
  await expect(badge).toHaveCSS('background-color', await token('--on-hue'));
  await expect(badge).toHaveCSS('color', await token('--hue-orange'));
  await expect(page.locator('.calendar-day-head.today')).toHaveCSS('background-color', await token('--hue-orange'));
  await expect(page.locator('.calendar-day-head:not(.today) span').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

/** The day the day view shows, and the first and last day of the strip above it, by accessible name. */
async function expectDayView(page: Page, range: string, selected: string, week: [first: string, last: string]): Promise<void> {
  await expect(page.locator('.calendar-range')).toHaveText(range);
  await expect(page.locator('.calendar-column')).toHaveCount(1);
  const strip = page.getByRole('group', { name: 'Days of the week' });
  await expect(strip.getByRole('button', { pressed: true })).toHaveAccessibleName(selected);
  await expect(strip.getByRole('button').first()).toHaveAccessibleName(week[0]);
  await expect(strip.getByRole('button').last()).toHaveAccessibleName(week[1]);
}

/** Swipes sideways across the calendar grid: left for the next day, right for the previous one. */
async function swipeDay(page: Page, direction: 'left' | 'right'): Promise<void> {
  const box = await calendarBodyBox(page);
  const y = box.y + box.height / 2;
  const [left, right] = [box.x + box.width * 0.2, box.x + box.width * 0.8];
  if (direction === 'left') await touchSwipe(page, { x: right, y }, { x: left, y });
  else await touchSwipe(page, { x: left, y }, { x: right, y });
}

test.describe('on a phone', () => {
  test.use(PHONE);

  // The strip runs from the account's first weekday, here Wednesday, so an entry on the Tuesday
  // before it counts on no day and not in the week total, although the calendar loads it.
  testWithSettings('the day view shows today under a strip of the week with daily totals, and a tapped day shows its entries', async ({ page, api }) => {
    await api.setWeekStart(3);
    // Madrid: Tuesday 16 June 09:00-11:00, Wednesday 17 June 09:00-10:30 and Monday 22 June 08:00-09:00 CEST.
    await api.entry({ description: 'Before the week', start: '2026-06-16T07:00:00Z', stop: '2026-06-16T09:00:00Z' });
    await api.entry({ description: 'Strip planning', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:30:00Z' });
    await api.entry({ description: 'Morning review', start: '2026-06-22T06:00:00Z', stop: '2026-06-22T07:00:00Z' });
    await page.clock.setFixedTime(new Date('2026-06-22T10:00:00Z'));
    await login(page);
    await openCalendar(page);

    const column = page.locator('.calendar-column');
    await expect(column).toHaveCount(1);
    await expect(column).toHaveClass(/\btoday\b/);
    await expect(column.getByRole('group', { name: 'Morning review, 1:00:00', exact: true })).toBeVisible();
    await expect(page.locator('.calendar-range')).toHaveText('Mon, 22 Jun');
    await expect(page.locator('.calendar-toolbar strong')).toHaveText('2:30:00');

    const strip = page.getByRole('group', { name: 'Days of the week' });
    const days = strip.getByRole('button');
    const names = [
      'Wed 17 Jun, 1:30:00', 'Thu 18 Jun, 0:00:00', 'Fri 19 Jun, 0:00:00', 'Sat 20 Jun, 0:00:00',
      'Sun 21 Jun, 0:00:00', 'Mon 22 Jun, 1:00:00', 'Tue 23 Jun, 0:00:00',
    ];
    await expect(days).toHaveCount(names.length);
    for (const [index, name] of names.entries()) await expect(days.nth(index)).toHaveAccessibleName(name);
    const today = strip.locator('.calendar-strip-day.today');
    await expect(today).toHaveAccessibleName('Mon 22 Jun, 1:00:00');
    await expect(today).toHaveAttribute('aria-pressed', 'true');

    await tap(strip.getByRole('button', { name: 'Wed 17 Jun' }));
    await expect(strip.getByRole('button', { pressed: true })).toHaveAccessibleName('Wed 17 Jun, 1:30:00');
    await expect(today).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.calendar-range')).toHaveText('Wed, 17 Jun');
    await expect(column).toHaveCount(1);
    await expect(column).not.toHaveClass(/\btoday\b/);
    await expect(column.getByRole('group', { name: 'Strip planning, 1:30:00', exact: true })).toBeVisible();
    await expect(column.getByRole('group', { name: /^Morning review/ })).toHaveCount(0);
  });

  // Sunday 21 June is today and the last day of a Monday week, so the next day is in another week:
  // the range, the strip and the entries follow it there and back.
  testWithSettings('swipes and the day arrows step one day across the week boundary, and T returns to today', async ({ page, api }) => {
    await api.setWeekStart(1);
    // Madrid: Sunday 21 June 09:00-10:00 and Monday 22 June 09:00-11:00 CEST.
    await api.entry({ description: 'Sunday review', start: '2026-06-21T07:00:00Z', stop: '2026-06-21T08:00:00Z' });
    await api.entry({ description: 'Monday planning', start: '2026-06-22T07:00:00Z', stop: '2026-06-22T09:00:00Z' });
    await page.clock.setFixedTime(new Date('2026-06-21T10:00:00Z'));
    await login(page);
    await openCalendar(page);
    const thisWeek: [string, string] = ['Mon 15 Jun, 0:00:00', 'Sun 21 Jun, 1:00:00'];
    const nextWeek: [string, string] = ['Mon 22 Jun, 2:00:00', 'Sun 28 Jun, 0:00:00'];
    const sunday = page.locator('.calendar-column.today').getByRole('group', { name: 'Sunday review, 1:00:00', exact: true });
    const monday = page.locator('.calendar-column').getByRole('group', { name: 'Monday planning, 2:00:00', exact: true });
    await expectDayView(page, 'Sun, 21 Jun', 'Sun 21 Jun, 1:00:00', thisWeek);
    await expect(sunday).toBeVisible();

    await tap(page.getByRole('button', { name: 'Next day' }));
    await expectDayView(page, 'Mon, 22 Jun', 'Mon 22 Jun, 2:00:00', nextWeek);
    await expect(monday).toBeVisible();
    await expect(page.locator('.calendar-strip-day.today')).toHaveCount(0);
    await tap(page.getByRole('button', { name: 'Previous day' }));
    await expectDayView(page, 'Sun, 21 Jun', 'Sun 21 Jun, 1:00:00', thisWeek);
    await expect(sunday).toBeVisible();

    await swipeDay(page, 'left');
    await expectDayView(page, 'Mon, 22 Jun', 'Mon 22 Jun, 2:00:00', nextWeek);
    await expect(monday).toBeVisible();
    await swipeDay(page, 'right');
    await expectDayView(page, 'Sun, 21 Jun', 'Sun 21 Jun, 1:00:00', thisWeek);
    await swipeDay(page, 'right');
    await expectDayView(page, 'Sat, 20 Jun', 'Sat 20 Jun, 0:00:00', thisWeek);

    for (let step = 0; step < 3; step++) await tap(page.getByRole('button', { name: 'Next day' }));
    await expectDayView(page, 'Tue, 23 Jun', 'Tue 23 Jun, 0:00:00', nextWeek);
    await page.keyboard.press('t');
    await expectDayView(page, 'Sun, 21 Jun', 'Sun 21 Jun, 1:00:00', thisWeek);
    await expect(sunday).toBeVisible();
  });

  test('a swipe that starts on a block changes the day and saves nothing', async ({ page, data }) => {
    // Madrid, Wednesday 2026-06-17: 09:00-10:00 CEST.
    const entry = await data.createEntry({ description: 'Swiped block', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z' });
    await page.clock.setFixedTime(new Date('2026-06-17T10:00:00Z'));
    await login(page);
    await openCalendar(page);
    await expect(page.locator('.calendar-range')).toHaveText('Wed, 17 Jun');
    const writes = entryWrites(page);
    // With 07:00 at the top of the grid, the block sits below the part the sticky timer bar covers.
    await scrollCalendarTo(page, 7);
    await calendarBodyBox(page);
    const block = (await todayBlock(page, 'Swiped block').boundingBox())!;
    const y = block.y + block.height / 2;

    // The finger lands on the block and wanders sideways before the long press, so it is a swipe,
    // not a move: the next day comes in and the block stays where it was.
    await touchSwipe(page, { x: block.x + block.width * 0.8, y }, { x: block.x + block.width * 0.2, y });
    await expect(page.locator('.calendar-range')).toHaveText('Thu, 18 Jun');
    await expect(page.locator('.calendar-column')).toHaveCount(1);
    await expect(page.locator('.calendar-block')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await savedTimes(page, entry.id)).toEqual({ start: '2026-06-17T07:00:00+00:00', stop: '2026-06-17T08:00:00+00:00' });
  });
});

// Exactly 760px is the narrowest week view: the day view is only below it.
for (const viewport of [{ width: 760, height: 900 }, { width: 1024, height: 768 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    testWithSettings('the calendar shows the whole week with week navigation, and T returns to this week', async ({ page, api }) => {
      await api.setWeekStart(1);
      await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
      await login(page);
      await openCalendar(page);
      await expect(page.locator('.calendar-column')).toHaveCount(7);
      await expect(page.locator('.calendar-day-head')).toHaveCount(7);
      await expect(page.getByRole('group', { name: 'Days of the week' })).toHaveCount(0);
      const range = page.locator('.calendar-range');
      await expect(range).toHaveText('15 Jun to 21 Jun');
      await expect(page.getByRole('button', { name: 'This week', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Next week', exact: true }).click();
      await expect(range).toHaveText('22 Jun to 28 Jun');
      await page.getByRole('button', { name: 'Next week', exact: true }).click();
      await expect(range).toHaveText('29 Jun to 5 Jul');
      await page.getByRole('button', { name: 'Previous week', exact: true }).click();
      await expect(range).toHaveText('22 Jun to 28 Jun');
      await page.keyboard.press('t');
      await expect(range).toHaveText('15 Jun to 21 Jun');
      await expect(page.locator('.calendar-column')).toHaveCount(7);
      await expect(page.locator('.calendar-column.today')).toBeVisible();
    });
  });
}

// The account is in Europe/Madrid and the browser in New York, where Madrid's midnight is still
// the evening before, so a chip on the wrong day would show up a column early.
test.describe('no-time entries', () => {
  test.use({ timezoneId: 'America/New_York', viewport: { width: 1280, height: 800 } });

  test('sit as chips in the all-day row on the account day, count in the day total and have no drag handles', async ({ page, data }) => {
    // Madrid: Monday 15 June, today, and the Sunday that ends the week.
    await data.createEntry({ description: 'Standup', start: '2026-06-15T07:00:00Z', stop: '2026-06-15T08:00:00Z' });
    const chores = await data.createNoTimeEntry({ description: 'Admin chores', day: '2026-06-15', duration: 5400 });
    await data.createNoTimeEntry({ description: 'Sunday errands', day: '2026-06-21', duration: 2700 });
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    await openCalendar(page);

    const allDay = page.getByRole('group', { name: 'All-day entries' });
    const cells = allDay.locator('.calendar-all-day-cell');
    await expect(cells).toHaveCount(7);
    const chip = cells.nth(0).getByRole('button', { name: 'Admin chores, 1:30:00', exact: true });
    await expect(chip).toBeVisible();
    await expect(cells.nth(6).getByRole('button', { name: 'Sunday errands, 0:45:00', exact: true })).toBeVisible();
    await expect(allDay.locator('.calendar-chip')).toHaveCount(2);
    // Chips stay out of the hour grid, whose only block is the timed entry.
    await expect(page.locator('.calendar-block:not(.calendar-ghost)')).toHaveCount(1);
    await expect(page.locator('.calendar-day-head').first().locator('small')).toHaveText('2:30:00');
    await expect(page.locator('.calendar-toolbar strong')).toHaveText('3:15:00');

    // No resize handle, and dragging a chip moves nothing.
    await expect(chip.locator('.calendar-resize')).toHaveCount(0);
    const writes = entryWrites(page);
    await dragBy(page, chip, 2);
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await savedTimes(page, chores.id)).toEqual({ start: '2026-06-14T22:00:00+00:00', stop: '2026-06-14T23:30:00+00:00' });

    // The phone day view keeps today's chip and total.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.calendar-column')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Days of the week' }).getByRole('button', { name: 'Mon 15 Jun, 2:30:00' })).toHaveAttribute('aria-pressed', 'true');
    await expect(allDay.locator('.calendar-all-day-cell')).toHaveCount(1);
    const phoneChip = allDay.getByRole('button', { name: 'Admin chores, 1:30:00', exact: true });
    await expect(phoneChip).toBeVisible();
    await expectFits(phoneChip);
    await expect(allDay.locator('.calendar-chip')).toHaveCount(1);
  });
});

test.describe('all-day creation', () => {
  test.use({ timezoneId: 'America/New_York', viewport: { width: 1280, height: 800 } });

  test('empty and occupied days create once, validate and retain a failed draft without changing dates or focus', async ({ page, data, runtimeErrors }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-06-17T10:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    expect((await (await page.request.get('/api/v9/me')).json()).timezone).toBe('Europe/Madrid');
    await openCalendar(page);
    const row = page.getByRole('group', { name: 'All-day entries' });
    const cells = row.locator('.calendar-all-day-cell');
    const adds = row.locator('.calendar-all-day-add');
    const dialog = page.getByRole('dialog', { name: 'Add all-day entry' });
    const writes = entryWrites(page);
    await expect(adds).toHaveCount(7);
    await expect(row.locator('.calendar-chip')).toHaveCount(0);
    for (let index = 0; index < 7; index++) {
      const cell = (await cells.nth(index).boundingBox())!;
      const head = (await page.locator('.calendar-day-head').nth(index).boundingBox())!;
      // Each day badge has a two-pixel horizontal margin inside its column.
      expect(cell.x + 2).toBeCloseTo(head.x, 1);
      expect(cell.width - 4).toBeCloseTo(head.width, 1);
    }
    await page.screenshot({ path: testInfo.outputPath('all-day-desktop-empty.png') });
    const beforeScroll = await row.boundingBox();
    await scrollCalendarTo(page, 18);
    expect(await page.locator('.calendar-body').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await row.boundingBox()).toEqual(beforeScroll);
    await page.screenshot({ path: testInfo.outputPath('all-day-desktop-hour-scroll.png') });

    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(page.locator('.calendar-range')).toHaveText('22 Jun to 28 Jun');
    const add = row.getByRole('button', { name: 'Add all-day entry for 2026-06-22', exact: true });
    // The last toolbar button precedes the first day in the native Tab order.
    await page.getByRole('button', { name: 'Next week', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(add).toBeFocused();
      expect(await add.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      expect(await add.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
      await page.screenshot({ path: testInfo.outputPath(`all-day-${colorScheme}-focus.png`) });
      await add.blur();
      const idle = await add.evaluate((element) => getComputedStyle(element).backgroundColor);
      await add.hover();
      await expect.poll(() => add.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(idle);
      await page.screenshot({ path: testInfo.outputPath(`all-day-${colorScheme}-hover.png`) });
      await page.mouse.move(0, 0);
      await page.getByRole('button', { name: 'Next week', exact: true }).focus();
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2026-06-22');
    await expect(dialog.getByRole('switch', { name: 'No times' })).toBeChecked();
    await expect(dialog.getByRole('switch', { name: 'No times' })).toBeDisabled();
    await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('');
    expect(writes).toEqual([]);
    await dialog.getByLabel('Description', { exact: true }).fill('Monday offline planning');
    await dialog.getByLabel('Duration', { exact: true }).fill('90m');
    await dialog.screenshot({ path: testInfo.outputPath('all-day-desktop-dialog.png') });
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).dblclick();
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    expect(writes).toEqual(['POST']);
    const entries = await (await page.request.get('/api/v9/me/time_entries?start_date=2026-06-21&end_date=2026-06-29')).json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      description: 'Monday offline planning', all_day: true, duration: 5400,
      start: '2026-06-21T22:00:00+00:00', stop: '2026-06-21T23:30:00+00:00',
    });
    await expect(cells.first().locator('.calendar-chip')).toHaveAccessibleName('Monday offline planning, 1:30:00');
    await expect(page.locator('.calendar-day-head').first().locator('small')).toHaveText('1:30:00');
    await expect(page.locator('.calendar-toolbar strong')).toHaveText('1:30:00');
    await page.screenshot({ path: testInfo.outputPath('all-day-desktop-occupied.png') });

    // Escape and Cancel both discard a populated draft without writing an entry.
    await page.keyboard.press('Space');
    await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Description', { exact: true }).fill('Discard with Escape');
    await dialog.getByLabel('Duration', { exact: true }).fill('2h');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click({ position: { x: 10, y: 10 } });
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Description', { exact: true }).fill('Discard with Cancel');
    await dialog.getByLabel('Duration', { exact: true }).fill('3h');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    expect(writes).toEqual(['POST']);
    expect(await data.entries()).toHaveLength(1);

    await add.click({ position: { x: 10, y: 10 } });
    await dialog.getByLabel('Description', { exact: true }).fill('Retained calendar draft');
    for (const [duration, message] of [
      ['', 'Enter a duration like 1:30 or 90m'],
      ['1m', 'The duration rounds to zero at the 5-minute time resolution'],
      ['25h', 'No-time entries can be at most 24 hours'],
    ]) {
      await dialog.getByLabel('Duration', { exact: true }).fill(duration!);
      await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(message!);
      expect(writes).toEqual(['POST']);
    }
    const createPath = /^\/api\/v9\/workspaces\/\d+\/time_entries$/;
    runtimeErrors.allowResponse({ status: 503, method: 'POST', path: createPath, reason: 'the scenario fails one calendar creation to verify retained draft and retry' });
    await page.route((url) => createPath.test(url.pathname), (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '"Calendar save unavailable"',
    }), { times: 1 });
    await dialog.getByLabel('Duration', { exact: true }).fill('45m');
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Calendar save unavailable' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Retained calendar draft');
    await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2026-06-22');
    await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('45m');
    expect(await data.entries()).toHaveLength(1);
    await dialog.screenshot({ path: testInfo.outputPath('all-day-failed-save-draft.png') });
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    expect(writes).toEqual(['POST', 'POST', 'POST']);
    expect(await data.entries()).toHaveLength(2);
    await expect(cells.first().locator('.calendar-chip')).toHaveCount(2);
    await expect(page.locator('.calendar-day-head').first().locator('small')).toHaveText('2:15:00');
    await expect(page.locator('.calendar-toolbar strong')).toHaveText('2:15:00');
    await cells.first().getByRole('button', { name: 'Retained calendar draft, 0:45:00', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(dialog).toHaveCount(0);
  });

  test('calendar creation keeps a manual draft and mode, then leaves a running timer identity and start unchanged', async ({ page }) => {
    await login(page);
    await openCalendar(page);
    const api = await TimerApi.open(page);
    const timer = page.getByRole('region', { name: 'Timer' });
    await timer.getByRole('button', { name: 'Manual mode' }).click();
    await timer.getByLabel('Description', { exact: true }).fill('Separate timer draft');
    await timer.getByRole('switch', { name: 'No times' }).check();
    await timer.getByLabel('Date', { exact: true }).fill('2026-06-16');
    await timer.getByLabel('Duration', { exact: true }).fill('2h');
    await expect.poll(async () => (await api.preferences()).manualMode).toBe(true);
    const row = page.getByRole('group', { name: 'All-day entries' });
    const dialog = page.getByRole('dialog', { name: 'Add all-day entry' });
    await row.locator('.calendar-all-day-add').first().click({ position: { x: 10, y: 10 } });
    await dialog.getByLabel('Description', { exact: true }).fill('Calendar while drafting');
    await dialog.getByLabel('Duration', { exact: true }).fill('30m');
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(timer.getByLabel('Description', { exact: true })).toHaveValue('Separate timer draft');
    await expect(timer.getByRole('switch', { name: 'No times' })).toBeChecked();
    await expect(timer.getByLabel('Date', { exact: true })).toHaveValue('2026-06-16');
    await expect(timer.getByLabel('Duration', { exact: true })).toHaveValue('2h');
    await expect(timer.getByRole('button', { name: 'Manual mode' })).toHaveAttribute('aria-pressed', 'true');
    expect((await api.preferences()).manualMode).toBe(true);

    await timer.getByRole('button', { name: 'Timer mode' }).click();
    await timer.getByRole('button', { name: 'Start timer' }).click();
    await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
    const running = await api.current();
    expect(running).not.toBeNull();
    const writes = entryWrites(page);
    await row.locator('.calendar-all-day-add').first().click({ position: { x: 10, y: 10 } });
    await dialog.getByLabel('Description', { exact: true }).fill('Calendar beside running timer');
    await dialog.getByLabel('Duration', { exact: true }).fill('45m');
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
    expect(await api.current()).toEqual(running);
    expect(writes).toEqual(['POST']);
    await expect(timer.getByLabel('Description', { exact: true })).toHaveValue('Separate timer draft');
    expect((await api.preferences()).manualMode).toBe(false);
  });
});

test.describe('all-day creation by touch', () => {
  test.use({ ...PHONE, timezoneId: 'America/New_York' });

  test('selected days create on the account DST day and keep the row and dialog inside the phone', async ({ page, data }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-03-28T11:00:00Z'));
    await login(page);
    await expectBrowserTimeZone(page, 'America/New_York');
    expect((await (await page.request.get('/api/v9/me')).json()).timezone).toBe('Europe/Madrid');
    await openCalendar(page);
    const row = page.getByRole('group', { name: 'All-day entries' });
    await expect(row.locator('.calendar-all-day-add')).toHaveCount(1);
    await expect(row.locator('.calendar-chip')).toHaveCount(0);
    await expectFits(row);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('all-day-phone-empty.png') });
    await tap(page.getByRole('button', { name: 'Next day', exact: true }));
    await expect(page.locator('.calendar-range')).toHaveText('Sun, 29 Mar');
    const add = row.getByRole('button', { name: 'Add all-day entry for 2026-03-29', exact: true });
    const writes = entryWrites(page);
    await tap(add);
    const dialog = page.getByRole('dialog', { name: 'Add all-day entry' });
    await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2026-03-29');
    await expect(dialog.getByRole('switch', { name: 'No times' })).toBeChecked();
    await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('');
    expect(writes).toEqual([]);
    await expectFits(dialog);
    await expectNoPageOverflow(page);
    await dialog.getByLabel('Description', { exact: true }).fill('Phone spring workshop');
    await dialog.getByLabel('Duration', { exact: true }).fill('4h');
    await page.screenshot({ path: testInfo.outputPath('all-day-phone-dialog.png') });
    await tap(dialog.getByRole('button', { name: 'Add entry', exact: true }));
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(['POST']);
    const entries = await (await page.request.get('/api/v9/me/time_entries?start_date=2026-03-27&end_date=2026-03-31')).json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      description: 'Phone spring workshop', all_day: true, duration: 14400,
      start: '2026-03-28T23:00:00+00:00', stop: '2026-03-29T03:00:00+00:00',
    });
    const chip = row.getByRole('button', { name: 'Phone spring workshop, 4:00:00', exact: true });
    await expect(chip).toBeVisible();
    await expectFits(chip);
    await expect(page.getByRole('group', { name: 'Days of the week' }).getByRole('button', { pressed: true })).toHaveAccessibleName('Sun 29 Mar, 4:00:00');
    await expect(page.locator('.calendar-toolbar strong')).toHaveText('4:00:00');
    const beforeScroll = await row.boundingBox();
    await scrollCalendarTo(page, 18);
    expect(await row.boundingBox()).toEqual(beforeScroll);
    await page.screenshot({ path: testInfo.outputPath('all-day-phone-occupied.png') });
    await tap(page.getByRole('button', { name: 'Next day', exact: true }));
    await expect(page.locator('.calendar-range')).toHaveText('Mon, 30 Mar');
    await expect(row.locator('.calendar-chip')).toHaveCount(0);
    await tap(row.getByRole('button', { name: 'Add all-day entry for 2026-03-30', exact: true }));
    await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2026-03-30');
    await tap(dialog.getByRole('button', { name: 'Cancel', exact: true }));
    await tap(page.getByRole('button', { name: 'Previous day', exact: true }));
    await tap(chip);
    await expect(page.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(['POST']);
    await expectNoPageOverflow(page);
  });
});
