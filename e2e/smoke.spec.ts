import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

test('start and stop a timer with a new project and tag', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Write the PRD');

  await timer.getByRole('button', { name: 'Project' }).click();
  await page.getByPlaceholder('Find or create project…').fill('Timetrack');
  await page.getByRole('button', { name: 'Create project "Timetrack"' }).click();

  await timer.getByRole('button', { name: 'Tags' }).click();
  await page.getByPlaceholder('Find or create tags…').fill('writing');
  await page.getByRole('button', { name: 'Create tag "writing"' }).click();
  await page.keyboard.press('Escape');

  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Write the PRD');
  await expect(page).toHaveTitle(/0:00:0\d · Write the PRD/);
  await page.screenshot({ path: 'test-results/timer-running.png' });

  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  const row = page.locator('.entry-line').first();
  await expect(row.getByLabel('Description')).toHaveValue('Write the PRD');
  await expect(row.locator('.project-label')).toContainText('Timetrack');
  await expect(row.locator('.tag-chip')).toHaveText('writing');
});

test('manual entry across midnight, edit and delete with undo', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Night deploy');
  await timer.getByLabel('Start time').fill('23:30');
  await timer.getByLabel('End time').fill('0:45');
  await expect(timer.locator('.manual-duration')).toHaveText('1:15:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 1:15:00')).toBeVisible();

  const row = page.locator('.entry-line', { has: page.locator('input[value="Night deploy"]') });
  await expect(row.locator('.entry-duration')).toHaveValue('1:15:00');

  await row.getByLabel('Duration').fill('2h');
  await row.getByLabel('Duration').press('Enter');
  await expect(row.locator('.entry-duration')).toHaveValue('2:00:00');

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('input[value="Night deploy"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('input[value="Night deploy"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/timer-list.png', fullPage: true });
});

test('keyboard shortcuts start, stop and continue', async ({ page, data }) => {
  // A finished entry from yesterday, 10:00 to 11:15 UTC, gives "c" something to continue
  // without crossing a day boundary in Europe/Madrid.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await data.createEntry({ description: 'Shortcut seed', start: `${day}T10:00:00Z`, stop: `${day}T11:15:00Z` });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Timer mode' }).click();
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('c');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Shortcut seed');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('s');
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
});

test('discard a running timer, then undo', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Started by mistake');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await timer.getByRole('button', { name: 'Discard running entry' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Started by mistake');
  await timer.getByRole('button', { name: 'Stop timer' }).click();
});
