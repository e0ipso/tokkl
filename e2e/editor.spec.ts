import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { openCalendar, savedTimes, scrollCalendarTo, todayBlock } from './history-calendar-tests-helpers.ts';

test('editing only the description keeps the stored start and stop', async ({ page }) => {
  await login(page);
  const me = await (await page.request.get('/api/v9/me')).json();
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const created = await (await page.request.post(`/api/v9/workspaces/${me.default_workspace_id}/time_entries`, {
    headers: { 'X-Tokkl-CSRF': '1' },
    data: { description: 'Seconds matter', start: `${day}T07:00:37Z`, stop: `${day}T08:15:12Z`, created_with: 'e2e' },
  })).json();
  // The server stores the span snapped to the default 5-minute resolution.
  expect([created.start, created.stop]).toEqual([`${day}T07:00:00+00:00`, `${day}T08:15:00+00:00`]);
  await page.reload();

  const row = page.locator('.entry-line', { has: page.locator('input[value="Seconds matter"]') });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await editor.getByLabel('Description').fill('Seconds still matter');
  // Tabbing through the duration field must not change anything either.
  await editor.getByLabel('Duration').focus();
  await editor.getByLabel('Duration').blur();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  const saved = await (await page.request.get(`/api/v9/me/time_entries/${created.id}`)).json();
  expect(saved.description).toBe('Seconds still matter');
  expect(saved.start).toBe(created.start);
  expect(saved.stop).toBe(created.stop);
});

// Overnight entries split at a clock time before their start, on the night the clocks change.
const OVERNIGHT_SPLITS = [
  // 22:00 CEST to 6:00 CET, split at 3:00 CET.
  { name: 'autumn', now: '2025-10-26T11:00:00Z', start: '2025-10-25T20:00:00Z', stop: '2025-10-26T05:00:00Z', at: '3:00', split: '2025-10-26T02:00:00+00:00' },
  // 22:00 CET to 7:00 CEST, split at 3:30 CEST.
  { name: 'spring', now: '2026-03-29T11:00:00Z', start: '2026-03-28T21:00:00Z', stop: '2026-03-29T05:00:00Z', at: '3:30', split: '2026-03-29T01:30:00+00:00' },
];

for (const night of OVERNIGHT_SPLITS) {
  test(`splitting an overnight entry on the ${night.name} clock change uses the next day's clock time`, async ({ page, data }) => {
    const { id } = await data.createEntry({ description: 'Night shift', start: night.start, stop: night.stop });
    await page.clock.setFixedTime(new Date(night.now));
    await login(page);
    const row = page.locator('.entry-line', { has: page.locator('input[value="Night shift"]') });
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit entry' });
    await editor.getByPlaceholder('e.g. 10:30').fill(night.at);
    await editor.getByRole('button', { name: 'Split' }).click();
    await expect(page.getByText('Entry split in two')).toBeVisible();

    const entries = await (await page.request.get('/api/v9/me/time_entries?start_date=2025-01-01&end_date=2027-01-01')).json();
    const parts = entries.map((entry: { id: number; start: string; stop: string }) => [entry.id === id, entry.start, entry.stop]);
    expect(parts).toHaveLength(2);
    expect(parts).toEqual(expect.arrayContaining([
      [true, night.start.replace('Z', '+00:00'), night.split],
      [false, night.split, night.stop.replace('Z', '+00:00')],
    ]));
  });
}

test('a no-time entry switches to timed and back from the editor, moving between the all-day row and the hour grid', async ({ page, data }) => {
  // Madrid, Monday 15 June: the entry's day is today.
  const { id } = await data.createNoTimeEntry({ description: 'Admin chores', day: '2026-06-15', duration: 5400 });
  await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
  await login(page);
  await openCalendar(page);
  const allDay = page.getByRole('group', { name: 'All-day entries' });
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  const noTimes = editor.getByRole('switch', { name: 'No times' });

  await allDay.getByRole('button', { name: 'Admin chores, 1:30:00', exact: true }).click();
  await expect(noTimes).toBeChecked();
  await expect(editor.getByLabel('Duration')).toHaveValue('1:30:00');
  await noTimes.uncheck();
  await expect(editor.getByLabel('Duration')).toHaveValue('');
  await expect(editor.getByLabel('Start', { exact: true })).toHaveValue('');
  // A timed entry needs both ends.
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByText('Check the start and end times')).toBeVisible();
  await editor.getByLabel('Start', { exact: true }).fill('9:00');
  await editor.getByLabel('End', { exact: true }).fill('10:30');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  await expect(allDay).toBeVisible();
  await expect(allDay.locator('.calendar-chip')).toHaveCount(0);
  await expect(allDay.locator('.calendar-all-day-add')).toHaveCount(7);
  await scrollCalendarTo(page, 8);
  await expect(todayBlock(page, 'Admin chores')).toHaveCSS('top', `${9 * 48}px`);
  await expect(todayBlock(page, 'Admin chores')).toHaveCSS('height', `${1.5 * 48}px`);
  expect(await savedTimes(page, id)).toEqual({ start: '2026-06-15T07:00:00+00:00', stop: '2026-06-15T08:30:00+00:00' });

  // Back to no times: the day stays, and the duration the fields showed is kept, then changed.
  await todayBlock(page, 'Admin chores').click();
  await expect(noTimes).not.toBeChecked();
  await noTimes.check();
  await expect(editor.getByLabel('Duration')).toHaveValue('1:30:00');
  await editor.getByLabel('Duration').fill('2h');
  await editor.getByLabel('Duration').press('Enter');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  await expect(allDay.getByRole('button', { name: 'Admin chores, 2:00:00', exact: true })).toBeVisible();
  await expect(page.locator('.calendar-block:not(.calendar-ghost)')).toHaveCount(0);
  expect(await savedTimes(page, id)).toEqual({ start: '2026-06-14T22:00:00+00:00', stop: '2026-06-15T00:00:00+00:00' });
  const saved = await (await page.request.get(`/api/v9/me/time_entries/${id}`)).json();
  expect(saved.all_day).toBe(true);
});
