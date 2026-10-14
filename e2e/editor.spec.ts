import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

test('editing only the description keeps start and stop seconds', async ({ page }) => {
  await login(page);
  const me = await (await page.request.get('/api/v9/me')).json();
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const created = await (await page.request.post(`/api/v9/workspaces/${me.default_workspace_id}/time_entries`, {
    headers: { 'X-Timetrack-CSRF': '1' },
    data: { description: 'Seconds matter', start: `${day}T07:00:37Z`, stop: `${day}T08:15:12Z`, created_with: 'e2e' },
  })).json();
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
  expect(saved.start).toBe(`${day}T07:00:37+00:00`);
  expect(saved.stop).toBe(`${day}T08:15:12+00:00`);
});
