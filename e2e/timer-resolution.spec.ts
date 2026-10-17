import { expect, test } from './admin-tests-helpers.ts';
import { login } from './helpers.ts';
import { TimerApi, instant, madridWallClock } from './timer-tests-helpers.ts';

// The time resolution belongs to the whole server, so these scenarios run in the instance project.
// The `instance` fixture puts the settings back after each one. Before saving, the web app shows
// the duration the server will store; a running timer keeps real seconds until it stops.

const MINUTE = 60_000;

test('at a 15-minute resolution the timer bar previews and announces snapped durations', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });

  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Short call');
  await timer.getByLabel('Date').fill('2025-11-12');
  await timer.getByLabel('Start time').fill('9:00');
  await timer.getByLabel('End time').fill('9:07');
  await expect(timer.locator('.manual-duration')).toHaveText('0:15:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 0:15:00')).toBeVisible();
  const manual = (await api.entries()).find((entry) => entry.description === 'Short call')!;
  expect([instant(manual.start), instant(manual.stop)]).toEqual([Date.parse('2025-11-12T08:00:00Z'), Date.parse('2025-11-12T08:15:00Z')]);

  // A duration typed into the idle timer saves an entry that ends now.
  await timer.getByRole('button', { name: 'Timer mode' }).click();
  await timer.getByLabel('Description').fill('Typed duration');
  await timer.getByLabel('Duration').fill('20m');
  await timer.getByLabel('Duration').press('Enter');
  await expect(page.getByText('Added 0:30:00')).toBeVisible();
  const typed = (await api.entries()).find((entry) => entry.description === 'Typed duration')!;
  expect(instant(typed.stop) - instant(typed.start)).toBe(30 * MINUTE);

  // The running timer and the tab title tick real seconds, not 0:15:00.
  await timer.getByLabel('Description').fill('Ticking');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: /elapsed, edit start time$/ })).toHaveText(/^0:00:0[2-9]$/);
  await expect(page).toHaveTitle(/^0:00:0[2-9] · Ticking$/);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect.poll(async () => {
    const stopped = (await api.entries()).find((entry) => entry.description === 'Ticking');
    return stopped?.stop ? instant(stopped.stop) - instant(stopped.start) : null;
  }).toBe(15 * MINUTE);
});

test('at a 15-minute resolution the entry editor previews snapped durations and split halves', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const start = Date.parse(`${day}T08:00:00Z`);
  const { id } = await data.createEntry({ description: 'Snapped edit', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z` });
  const clock = (offsetMinutes: number) => madridWallClock(new Date(start + offsetMinutes * MINUTE)).time;
  await login(page);
  const row = page.locator('.entry-line', { has: page.locator('input[value="Snapped edit"]') });
  const openEditor = async () => {
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    return page.getByRole('dialog', { name: 'Edit entry' });
  };

  let editor = await openEditor();
  const duration = editor.getByLabel('Duration');
  await expect(duration).toHaveValue('1:00:00');
  // A typed duration shows the length the server will store and moves the end by what was typed.
  await duration.fill('20m');
  await duration.blur();
  await expect(duration).toHaveValue('0:30:00');
  await expect(editor.getByLabel('End')).toHaveValue(clock(20));
  // An end seven minutes past the hour rounds the duration up to the next step.
  await editor.getByLabel('End').fill(clock(67));
  await editor.getByLabel('End').blur();
  await expect(duration).toHaveValue('1:15:00');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const api = await TimerApi.open(page);
  const saved = (await api.entries()).find((entry) => entry.id === id)!;
  expect(instant(saved.stop) - instant(saved.start)).toBe(75 * MINUTE);

  editor = await openEditor();
  await expect(editor.getByLabel('Duration')).toHaveValue('1:15:00');
  const splitAt = editor.getByLabel('Split at');
  // A split time that snaps onto the entry's start or stop leaves nothing to split off.
  for (const offset of [5, 70]) {
    await splitAt.fill(clock(offset));
    await editor.getByRole('button', { name: 'Split' }).click();
    await expect(editor.getByText('The split time must fall inside the entry')).toBeVisible();
    await expect(editor.getByText(/^Splits into/)).toBeHidden();
  }
  expect((await api.entries()).filter((entry) => entry.description === 'Snapped edit')).toHaveLength(1);

  // A split at 37 minutes moves to the grid point at 30, which both halves share.
  await splitAt.fill(clock(37));
  await expect(editor.getByText('Splits into 0:30:00 and 0:45:00.')).toBeVisible();
  await editor.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Entry split in two')).toBeVisible();
  const halves = (await api.entries())
    .filter((entry) => entry.description === 'Snapped edit')
    .map((entry) => [instant(entry.start), instant(entry.stop)])
    .sort(([a], [b]) => a! - b!);
  expect(halves).toEqual([[start, start + 30 * MINUTE], [start + 30 * MINUTE, start + 75 * MINUTE]]);
});
