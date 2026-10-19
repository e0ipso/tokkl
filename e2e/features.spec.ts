import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { madridWallClock, TimerApi } from './timer-tests-helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

test('favorites, split, shortcut help and trash restore', async ({ page }) => {
  // The grouped entries go on a day well in the past. A timer started now can land on the next day
  // (local midnight passes, or its start snaps forward to 0:00), and would then not group with them.
  const pastDay = madridWallClock(new Date(Date.now() - 3 * DAY_MS)).day;
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Date', { exact: true }).fill(pastDay);
  await timer.getByLabel('Description').fill('Pairing session');
  await timer.getByLabel('Start time').fill('8:00');
  await timer.getByLabel('End time').fill('10:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  const row = page.locator('.entry-line', { has: page.locator('input[value="Pairing session"]') });
  await expect(row).toHaveCount(1);

  // Pin as favorite, then start it with the "1" key.
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Pin as favorite' }).click();
  await expect(page.getByRole('region', { name: 'Favorites' }).or(page.locator('.favorites'))).toContainText('Pairing session');
  await timer.getByRole('button', { name: 'Timer mode' }).click();
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('1');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Pairing session');
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  const api = await TimerApi.open(page);
  await expect.poll(() => api.current()).toBeNull();
  expect((await api.entries()).filter((entry) => entry.description === 'Pairing session')).toHaveLength(2);

  // A similar entry on the same past day groups with the manual one; expand the group, then split
  // the 2-hour entry at 9:00. Noon UTC falls on the same day in Europe/Madrid.
  await api.createEntry({ description: 'Pairing session', start: `${pastDay}T12:00:00Z`, stop: `${pastDay}T12:30:00Z` });
  await page.reload();
  await page.locator('.count-badge').first().click();
  const twoHours = page.locator('.entries.nested .entry-line', { has: page.locator('input.entry-duration[value="2:00:00"]') });
  await twoHours.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await editor.getByPlaceholder('e.g. 10:30').fill('9:00');
  await editor.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText('Entry split in two')).toBeVisible();
  // The group stays expanded across the refetch.
  await expect(page.locator('.entries.nested input.entry-duration[value="1:00:00"]')).toHaveCount(2);

  // Shortcut overlay.
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Delete, let the toast go, restore from the trash.
  const first = page.locator('.entries.nested .entry-line', { has: page.locator('input.entry-duration[value="1:00:00"]') }).first();
  const before = await page.locator('.entries.nested .entry-line').count();
  await first.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await page.getByRole('link', { name: 'Timer' }).click();
  await page.locator('.count-badge').first().click();
  await expect(page.locator('.entries.nested .entry-line')).toHaveCount(before);

  // An entry overlapping the 8:00-9:00 part gets flagged.
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Date', { exact: true }).fill(pastDay);
  await timer.getByLabel('Description').fill('Overlapping call');
  await timer.getByLabel('Start time').fill('8:30');
  await timer.getByLabel('End time').fill('8:45');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.entry-line', { has: page.locator('input[value="Overlapping call"]') }).locator('.overlap-mark')).toBeVisible();
});
