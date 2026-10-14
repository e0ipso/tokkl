import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  EntityApi, expectSameDocument, markDocument, rowAction, timerPickerProjects, yesterday, type Entry,
} from './entity-tests-helpers.ts';

/** The fields an entry must keep when its project goes away. */
function kept(entry: Entry) {
  return { id: entry.id, description: entry.description, start: entry.start, stop: entry.stop, tags: entry.tags, billable: entry.billable };
}

test('project settings, rate and estimate persist, and archiving hides the project from the picker until restored', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const project = await api.createProject({ name: 'Website' });
  await api.createEntry({ description: 'Homepage copy', start: `${day}T10:00:00Z`, stop: `${day}T11:00:00Z`, project_id: project.id });

  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit Website' }).click();
  let editor = page.getByRole('dialog', { name: 'Edit project' });
  await editor.getByLabel('Hourly rate').fill('80');
  await editor.getByLabel('Currency').fill('usd');
  await editor.getByLabel('Estimated hours').fill('4');
  await editor.getByLabel('Billable by default').check();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  expect(await api.project(project.id)).toMatchObject({ rate: 80, currency: 'USD', estimated_hours: 4, billable: true, active: true });
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Edit Website' }) });
  await expect(row.getByRole('cell').nth(3)).toHaveText('Yes');
  await expect(row.getByRole('cell').nth(4)).toContainText('80.00');
  // One tracked hour of a four-hour estimate.
  await expect(row.getByRole('cell').nth(5)).toHaveText('1:00:00');
  await expect(row.getByRole('progressbar', { name: 'Estimate used' })).toHaveAttribute('aria-valuenow', '25');
  await expect(row).toContainText('25% of 4 h');

  // A fresh load shows the saved values in the editor.
  await page.reload();
  await page.getByRole('button', { name: 'Edit Website' }).click();
  editor = page.getByRole('dialog', { name: 'Edit project' });
  await expect(editor.getByLabel('Hourly rate')).toHaveValue('80');
  await expect(editor.getByLabel('Currency')).toHaveValue('USD');
  await expect(editor.getByLabel('Estimated hours')).toHaveValue('4');
  await expect(editor.getByLabel('Billable by default')).toBeChecked();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();

  await page.getByRole('link', { name: 'Timer' }).click();
  expect(await timerPickerProjects(page)).toContain('Website');

  await page.getByRole('link', { name: 'Projects' }).click();
  await rowAction(page, 'Website', 'Archive');
  await expect.poll(async () => (await api.project(project.id)).active).toBe(false);
  await expect(page.getByRole('button', { name: 'Edit Website' })).toHaveCount(0);
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Archived' }).click();
  await expect(page.getByRole('button', { name: 'Edit Website' })).toBeVisible();
  await page.getByRole('link', { name: 'Timer' }).click();
  expect(await timerPickerProjects(page)).not.toContain('Website');

  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Archived' }).click();
  await rowAction(page, 'Website', 'Restore');
  await expect.poll(async () => (await api.project(project.id)).active).toBe(true);
  await page.getByRole('link', { name: 'Timer' }).click();
  expect(await timerPickerProjects(page)).toContain('Website');
  // Archiving and restoring left the settings alone.
  expect(await api.project(project.id)).toMatchObject({ rate: 80, currency: 'USD', estimated_hours: 4, billable: true });
});

test('deleting a project and keeping its entries clears their project and refreshes the report', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const project = await api.createProject({ name: 'Keep me' });
  const seeded = [
    await api.createEntry({ description: 'Kept one', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z`, project_id: project.id, tags: ['kept'], billable: true }),
    await api.createEntry({ description: 'Kept two', start: `${day}T09:30:00Z`, stop: `${day}T10:00:00Z`, project_id: project.id }),
  ];
  const before = await Promise.all(seeded.map((entry) => api.entry(entry.id)));

  await page.goto('/reports?range=all_time');
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  await expect(breakdown.getByText('Keep me')).toBeVisible();
  await expect(breakdown.getByText('Without project')).toHaveCount(0);
  await markDocument(page);

  await page.getByRole('link', { name: 'Projects' }).click();
  await rowAction(page, 'Keep me', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete Keep me?' });
  await expect(dialog).toContainText('It has 1:30:00 of tracked time.');
  await dialog.getByRole('button', { name: 'Keep entries' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deleted Keep me. Its entries no longer have a project')).toBeVisible();

  expect((await api.projects()).map((p) => p.id)).not.toContain(project.id);
  const after = await Promise.all(seeded.map((entry) => api.entry(entry.id)));
  expect(after.map(kept)).toEqual(before.map(kept));
  expect(after.map((entry) => entry.project_id)).toEqual([null, null]);
  expect(await api.trash()).toEqual([]);

  // Back to the report the app already had in its cache: it must show the change.
  await page.goBack();
  await expectSameDocument(page);
  await expect(breakdown.getByText('Without project')).toBeVisible();
  await expect(breakdown.getByText('Keep me')).toHaveCount(0);
});

test('deleting a project with its entries moves them to the trash and refreshes the report', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const project = await api.createProject({ name: 'Drop me' });
  const dropped = [
    await api.createEntry({ description: 'Dropped one', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z`, project_id: project.id }),
    await api.createEntry({ description: 'Dropped two', start: `${day}T09:30:00Z`, stop: `${day}T10:00:00Z`, project_id: project.id }),
  ];
  const survivor = await api.createEntry({ description: 'Survivor', start: `${day}T11:00:00Z`, stop: `${day}T11:15:00Z` });

  await page.goto('/reports?range=all_time');
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  await expect(breakdown.getByText('Drop me')).toBeVisible();
  await markDocument(page);

  await page.getByRole('link', { name: 'Projects' }).click();
  await rowAction(page, 'Drop me', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete Drop me?' });
  await dialog.getByRole('button', { name: 'Delete entries too' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deleted Drop me and moved its entries to the trash')).toBeVisible();

  expect((await api.projects()).map((p) => p.id)).not.toContain(project.id);
  expect((await api.entries()).map((entry) => entry.id)).toEqual([survivor.id]);
  const trash = await api.trash();
  expect(trash.map((entry) => entry.id).sort()).toEqual(dropped.map((entry) => entry.id).sort());
  expect(trash.map((entry) => entry.description).sort()).toEqual(['Dropped one', 'Dropped two']);

  await page.goBack();
  await expectSameDocument(page);
  await expect(breakdown.getByText('Without project')).toBeVisible();
  await expect(breakdown.getByText('Drop me')).toHaveCount(0);

  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Dropped one' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Dropped two' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Survivor' })).toHaveCount(0);
});
