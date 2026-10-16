import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  EntityApi, entryRow, expectSameDocument, markDocument, rowAction, rowActionByKeyboard, rowMenu, timerPickerProjects, yesterday,
  type Entry,
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

// TT-0199: a dialog opened from a row menu gives focus back to that row's menu button, since the
// menu item that opened it is gone.
test('closing a dialog opened from the row menu returns focus to the menu button', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const intranet = await api.createProject({ name: 'Intranet' });
  await api.createProject({ name: 'Website' });
  await page.getByRole('link', { name: 'Projects' }).click();
  const more = (name: string) => rowMenu(page, name);
  const choose = (name: string, action: string) => rowActionByKeyboard(page, name, action);

  await choose('Website', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete Website?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more('Website')).toBeFocused();

  // Archiving from the menu by keyboard still works.
  await choose('Intranet', 'Archive');
  await expect.poll(async () => (await api.project(intranet.id)).active).toBe(false);
  await expect(page.getByRole('button', { name: 'Edit Intranet' })).toHaveCount(0);
});

// TT-0200: a row that leaves the list after an action from its menu takes the focused menu button
// with it, so focus moves to the next row, else the previous one, else the page heading.
test('archiving or deleting a project by keyboard keeps focus in the projects list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  for (const name of ['Alpha', 'Beta', 'Gamma']) await api.createProject({ name });
  await page.getByRole('link', { name: 'Projects' }).click();
  const edit = (name: string) => page.getByRole('button', { name: `Edit ${name}`, exact: true });

  await rowActionByKeyboard(page, 'Beta', 'Archive');
  await expect(edit('Beta')).toHaveCount(0);
  await expect(rowMenu(page, 'Gamma')).toBeFocused();

  await rowActionByKeyboard(page, 'Gamma', 'Archive');
  await expect(edit('Gamma')).toHaveCount(0);
  await expect(rowMenu(page, 'Alpha')).toBeFocused();

  await rowActionByKeyboard(page, 'Alpha', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete Alpha?' });
  await dialog.getByRole('button', { name: 'Delete project' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('No projects match these filters')).toBeVisible();
  const heading = page.getByRole('heading', { level: 1, name: 'Projects' });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveCSS('outline-width', '2px');

  // A row that stays in the list, as under All, keeps focus on its own menu button.
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'All' }).click();
  await rowActionByKeyboard(page, 'Beta', 'Restore');
  await expect.poll(async () => (await api.projects()).find((project) => project.name === 'Beta')?.active).toBe(true);
  await expect(rowMenu(page, 'Beta')).toBeFocused();
});

// TT-0200: focus moves past a leaving row only when it would otherwise be lost. A user who moves to
// another control while the archive request runs keeps focus there.
test('archiving a project leaves focus alone when the user moved it while the request ran', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  await api.createProject({ name: 'Alpha' });
  const beta = await api.createProject({ name: 'Beta' });
  await api.createProject({ name: 'Gamma' });
  await page.getByRole('link', { name: 'Projects' }).click();

  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let held!: () => void;
  const archiveHeld = new Promise<void>((resolve) => { held = resolve; });
  await page.route(`**/api/v9/workspaces/*/projects/${beta.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    held();
    await released;
    await route.continue();
  });

  await rowActionByKeyboard(page, 'Beta', 'Archive');
  await archiveHeld;
  const search = page.getByRole('searchbox', { name: 'Search projects' });
  await search.click();
  await expect(search).toBeFocused();
  release();

  await expect(page.getByText('Archived Beta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Beta', exact: true })).toHaveCount(0);
  await expect(search).toBeFocused();
  expect((await api.project(beta.id)).active).toBe(false);
});

// TT-0200: restoring a project under the Archived filter takes its row, and the focused menu button,
// out of the list, so focus moves to another row's menu, else the page heading.
test('restoring archived projects by keyboard keeps focus in the projects list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  for (const name of ['Alpha', 'Beta']) await api.createProject({ name, active: false });
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Archived' }).click();
  const edit = (name: string) => page.getByRole('button', { name: `Edit ${name}`, exact: true });

  await rowActionByKeyboard(page, 'Alpha', 'Restore');
  await expect(edit('Alpha')).toHaveCount(0);
  await expect(rowMenu(page, 'Beta')).toBeFocused();

  await rowActionByKeyboard(page, 'Beta', 'Restore');
  await expect(page.getByText('No projects match these filters')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeFocused();
  expect((await api.projects()).map(({ name, active }) => [name, active])).toEqual([['Alpha', true], ['Beta', true]]);
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

/** The colour --text resolves to on this page. */
function textToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--text)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}

/** The project's colour reaches the dot through --project-color; the name stays in --text. */
async function expectColourOnDotOnly(name: Locator, dot: Locator, hex: string, text: string) {
  await expect(name).toHaveCSS('color', text);
  expect(await dot.evaluate((el) => getComputedStyle(el).getPropertyValue('--project-color').trim())).toBe(hex);
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(text);
}

// TT-0069: no text is painted in a project colour; the colour only marks the dot.
test('a project colour marks its dot while the entry row, picker and Projects table names stay in the text colour', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const project = await api.createProject({ name: 'Website' });
  await api.createEntry({ description: 'Homepage copy', start: `${day}T10:00:00Z`, stop: `${day}T11:00:00Z`, project_id: project.id });
  await page.reload();
  const text = await textToken(page);

  const label = entryRow(page, 'Homepage copy').locator('.project-label');
  await expectColourOnDotOnly(label.locator('.project-label-name'), label.locator('.project-dot'), project.color, text);

  await page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Project' }).click();
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create project…') });
  const item = picker.locator('.picker-item', { hasText: 'Website' });
  await expectColourOnDotOnly(item, item.locator('.project-dot'), project.color, text);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  await page.getByRole('link', { name: 'Projects' }).click();
  const name = page.locator('.manage-name-button', { hasText: 'Website' });
  await expectColourOnDotOnly(name.locator('span:not(.project-dot)'), name.locator('.project-dot'), project.color, text);
});
