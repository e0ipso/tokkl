import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

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
