import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  EntityApi, entryRow, rowAction, rowActionByKeyboard, rowMenu, timerPickerProjects, yesterday, type Entry,
} from './entity-tests-helpers.ts';

/** Everything about an entry that deleting its client must not change. */
function metadata(entry: Entry) {
  return {
    id: entry.id, description: entry.description, project_id: entry.project_id, task_id: entry.task_id,
    tags: entry.tags, billable: entry.billable, start: entry.start, stop: entry.stop,
  };
}

test('client name and notes persist, and archiving and restoring the client carries its projects along', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);

  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'New client' }).click();
  let editor = page.getByRole('dialog', { name: 'New client' });
  await editor.getByLabel('Name').fill('Northwind');
  await editor.getByLabel('Notes').fill('Net 30');
  await editor.getByRole('button', { name: 'Create client' }).click();
  await expect(editor).toBeHidden();
  const [client] = await api.clients();
  expect(client).toMatchObject({ name: 'Northwind', notes: 'Net 30', archived: false });

  const portal = await api.createProject({ name: 'Portal', client_id: client!.id });
  const audit = await api.createProject({ name: 'Audit', client_id: client!.id });
  const other = await api.createProject({ name: 'In house' });

  await page.reload();
  await page.getByRole('button', { name: 'Edit Northwind' }).click();
  editor = page.getByRole('dialog', { name: 'Edit client' });
  await expect(editor.getByLabel('Notes')).toHaveValue('Net 30');
  await editor.getByLabel('Name').fill('Northwind Traders');
  await editor.getByLabel('Notes').fill('Net 45\nPO number required');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  expect(await api.client(client!.id)).toMatchObject({ name: 'Northwind Traders', notes: 'Net 45\nPO number required' });

  await page.reload();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Edit Northwind Traders' }) });
  await expect(row.getByRole('cell').nth(1)).toHaveText('Net 45\nPO number required');
  await expect(row.getByRole('cell').nth(2)).toHaveText('2');
  await page.getByRole('button', { name: 'Edit Northwind Traders' }).click();
  editor = page.getByRole('dialog', { name: 'Edit client' });
  await expect(editor.getByLabel('Name')).toHaveValue('Northwind Traders');
  await expect(editor.getByLabel('Notes')).toHaveValue('Net 45\nPO number required');
  await editor.getByRole('button', { name: 'Cancel' }).click();

  // The rename shows on the client's projects.
  await page.getByRole('link', { name: 'Projects' }).click();
  for (const name of ['Portal', 'Audit']) {
    await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: `Edit ${name}` }) })).toContainText('Northwind Traders');
  }

  await page.getByRole('link', { name: 'Clients' }).click();
  await rowAction(page, 'Northwind Traders', 'Archive');
  const confirm = page.getByRole('dialog', { name: 'Archive Northwind Traders?' });
  await expect(confirm).toContainText('This also archives its 2 projects.');
  await confirm.getByRole('button', { name: 'Archive' }).click();
  await expect(confirm).toBeHidden();
  expect((await api.client(client!.id)).archived).toBe(true);
  expect((await api.projects()).map((p) => [p.name, p.active]).sort())
    .toEqual([['Audit', false], ['In house', true], ['Portal', false]]);
  await page.getByRole('link', { name: 'Timer' }).click();
  expect(await timerPickerProjects(page)).toEqual(['No project', 'In house']);

  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('group', { name: 'Client status' }).getByRole('button', { name: 'Archived' }).click();
  await rowAction(page, 'Northwind Traders', 'Restore');
  await expect(page.getByText('Restored Northwind Traders and its projects')).toBeVisible();
  expect((await api.client(client!.id)).archived).toBe(false);
  expect((await api.projects()).every((p) => p.active)).toBe(true);
  await page.getByRole('link', { name: 'Timer' }).click();
  expect((await timerPickerProjects(page)).sort()).toEqual(['Audit', 'In house', 'No project', 'Portal']);
  // Archive and restore kept project identities.
  expect((await api.projects()).map((p) => p.id).sort()).toEqual([portal.id, audit.id, other.id].sort());
});

test('deleting a client keeps project IDs and entry metadata and numbers colliding names', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const acme = await api.createClient('Acme');
  const plain = await api.createProject({ name: 'Website' });
  const firstRename = await api.createProject({ name: 'Website (Acme)' });
  const website = await api.createProject({ name: 'website', client_id: acme.id, billable: true });
  const intranet = await api.createProject({ name: 'Intranet', client_id: acme.id });
  const seeded = [
    await api.createEntry({ description: 'Landing page', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z`, project_id: website.id, tags: ['design'], billable: true }),
    await api.createEntry({ description: 'Wiki cleanup', start: `${day}T10:00:00Z`, stop: `${day}T10:45:00Z`, project_id: intranet.id }),
  ];
  const before = await Promise.all(seeded.map((entry) => api.entry(entry.id)));

  await page.getByRole('link', { name: 'Clients' }).click();
  await rowAction(page, 'Acme', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete Acme?' });
  await expect(dialog).toContainText('Its 2 projects stay, without a client.');
  await dialog.getByRole('button', { name: 'Delete client' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deleted Acme')).toBeVisible();

  expect(await api.clients()).toEqual([]);
  const projects = await api.projects();
  // "website (Acme)" is taken (case-insensitively), so the moved project gets the next number.
  expect(projects.map((p) => [p.id, p.name, p.client_id]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
    [plain.id, 'Website', null],
    [firstRename.id, 'Website (Acme)', null],
    [website.id, 'website (Acme) 2', null],
    [intranet.id, 'Intranet', null],
  ]);
  expect(projects.find((p) => p.id === website.id)?.billable).toBe(true);
  const after = await Promise.all(seeded.map((entry) => api.entry(entry.id)));
  expect(after.map(metadata)).toEqual(before.map(metadata));

  await page.getByRole('link', { name: 'Timer' }).click();
  await expect(entryRow(page, 'Landing page').locator('.project-label')).toContainText('website (Acme) 2');
  await expect(entryRow(page, 'Landing page').locator('.tag-chip')).toHaveText('design');
  await expect(entryRow(page, 'Wiki cleanup').locator('.project-label')).toContainText('Intranet');

  // The same collision again takes the following number.
  const again = await api.createClient('Acme');
  const third = await api.createProject({ name: 'WEBSITE', client_id: again.id });
  await page.getByRole('link', { name: 'Clients' }).click();
  await rowAction(page, 'Acme', 'Delete');
  await page.getByRole('dialog', { name: 'Delete Acme?' }).getByRole('button', { name: 'Delete client' }).click();
  await expect.poll(async () => (await api.project(third.id)).name).toBe('WEBSITE (Acme) 3');
  expect((await api.project(third.id)).client_id).toBeNull();
});

// TT-0200: a client row that leaves the list after a confirm dialog from its menu takes the menu
// button the dialog would return to, so focus moves to the next row, else the previous one, else the
// page heading.
test('deleting or archiving a client by keyboard keeps focus in the clients list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  for (const name of ['Acme', 'Globex', 'Initech']) await api.createClient(name);
  await page.getByRole('link', { name: 'Clients' }).click();
  const edit = (name: string) => page.getByRole('button', { name: `Edit ${name}`, exact: true });
  const confirm = async (title: string, label: string) => {
    const dialog = page.getByRole('dialog', { name: title });
    await dialog.getByRole('button', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
  };

  await rowActionByKeyboard(page, 'Globex', 'Delete');
  await confirm('Delete Globex?', 'Delete client');
  await expect(edit('Globex')).toHaveCount(0);
  await expect(rowMenu(page, 'Initech')).toBeFocused();

  await rowActionByKeyboard(page, 'Initech', 'Archive');
  await confirm('Archive Initech?', 'Archive');
  await expect(edit('Initech')).toHaveCount(0);
  await expect(rowMenu(page, 'Acme')).toBeFocused();

  await rowActionByKeyboard(page, 'Acme', 'Delete');
  await confirm('Delete Acme?', 'Delete client');
  await expect(page.getByText('No clients match these filters')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeFocused();
  expect((await api.clients()).map((client) => client.name)).toEqual(['Initech']);
});

// TT-0200: restoring a client under the Archived filter takes its row, and the focused menu button,
// out of the list, so focus moves to another row's menu, else the page heading.
test('restoring archived clients by keyboard keeps focus in the clients list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  for (const name of ['Acme', 'Globex']) await api.archiveClient((await api.createClient(name)).id);
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('group', { name: 'Client status' }).getByRole('button', { name: 'Archived' }).click();
  const edit = (name: string) => page.getByRole('button', { name: `Edit ${name}`, exact: true });

  await rowActionByKeyboard(page, 'Globex', 'Restore');
  await expect(edit('Globex')).toHaveCount(0);
  await expect(rowMenu(page, 'Acme')).toBeFocused();

  await rowActionByKeyboard(page, 'Acme', 'Restore');
  await expect(page.getByText('No clients match these filters')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeFocused();
  expect((await api.clients()).map(({ name, archived }) => [name, archived])).toEqual([['Acme', false], ['Globex', false]]);
});
