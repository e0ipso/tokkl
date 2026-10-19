import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';
import { openCalendar } from './history-calendar-tests-helpers.ts';
import { calendarBodyBox, entryWrites, px, savedTimes, scrollCalendarTo, todayBlock, touchSwipe } from './history-calendar-tests-helpers.ts';
import { PHONE, tap } from './mobile-tests-helpers.ts';
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

// A switch within half a step of a timer's start stores a zero-length entry, and the next entry
// starts where it ends. Lanes follow the stored spans, so the pair shares one lane with the thin
// marker above its successor. Spans that overlap still sit side by side.
test('a zero-length entry shares its successor\'s lane and both stay clickable, while overlapping entries split lanes', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid, Wednesday 2026-06-17 (CEST): the switch at 09:00, then two overlapping entries from 11:00.
  await data.createEntry({ description: 'Switch', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T07:00:00Z' });
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

// Quick switches inside one half step store several zero-length entries on one grid point. They
// sit side by side so each stays clickable, and the entry that starts there keeps its full width.
test('zero-length entries at one instant sit side by side and each opens its own editor', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  // Madrid, Wednesday 2026-06-17 (CEST): two switches at 09:00, then an entry that starts there.
  await data.createEntry({ description: 'Switch one', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T07:00:00Z' });
  await data.createEntry({ description: 'Switch two', start: '2026-06-17T07:00:00Z', stop: '2026-06-17T07:00:00Z' });
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

// The running block and the now line use --state-running, the running block is dashed so
// colour is not its only mark, and only today's day head is a filled badge.
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
  await expect(badge).toHaveCSS('background-color', await token('--primary'));
  await expect(badge).toHaveCSS('color', await token('--on-primary'));
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
