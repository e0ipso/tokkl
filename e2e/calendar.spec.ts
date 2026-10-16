import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';
import { openCalendar } from './history-calendar-tests-helpers.ts';

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
