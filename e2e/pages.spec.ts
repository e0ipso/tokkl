import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

test('every page renders without errors and core management flows work', async ({ page }) => {
  // Logging in starts with an expected 403 from /api/v9/me, so collect errors only afterwards.
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name', { exact: true }).fill('Client site');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('cell', { name: /Client site/ }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/page-projects.png', fullPage: true });

  for (const [name, file] of [['Clients', 'clients'], ['Tags', 'tags'], ['Trash', 'trash'], ['Settings', 'settings'], ['Reports', 'reports']] as const) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: `test-results/page-${file}.png`, fullPage: true });
  }

  // Restoring our own export finds everything already present.
  const exported = await (await page.request.get('/api/app/export.json')).body();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('input[type=file][accept*="json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: exported });
  await expect(page.getByText('0 entries to add')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();

  // Reload on a deep link must serve the app, not an API error.
  await page.goto('/reports?range=last_week&tab=detailed');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.goto('/reports?range=all_time');
  await expect(page.getByText('All time')).toBeVisible();
  await page.goto('/reports?range=all_time&tags=not.none');
  await expect(page.getByRole('button', { name: /Tag.*not Without tags/ })).toBeVisible();
  await page.getByRole('button', { name: /Tag.*not Without tags/ }).click();
  await page.getByRole('button', { name: 'Is', exact: true }).click();
  await expect(page).toHaveURL(/tags=none/);
  expect(errors).toEqual([]);
});
