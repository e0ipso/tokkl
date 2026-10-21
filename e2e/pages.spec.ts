import { expect, test } from './fixtures.ts';
import { expectSectionHue, login } from './helpers.ts';

test('every page renders without errors and core management flows work', async ({ page }) => {
  // The runtimeErrors fixture fails this scenario on any page error, console error or failed request.
  await login(page);

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
});

test('deleting a client renames its project when a clientless one has the same name', async ({ page, data }) => {
  const acme = await data.createClient('Acme');
  const kept = await data.createProject({ name: 'Website' });
  const moved = await data.createProject({ name: 'Website', client_id: acme.id });
  await login(page);
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'More actions for Acme' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Acme?' });
  await expect(dialog).toContainText('If a project without a client already has the same name, "(Acme)" is added to the moved one.');
  await dialog.getByRole('button', { name: 'Delete client' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('cell', { name: 'Website (Acme)', exact: true })).toBeVisible();
  const projects = await (await page.request.get(`/api/v9/workspaces/${data.workspaceId}/projects?active=both`)).json();
  expect(projects.map((p: { id: number; name: string; client_id: number | null }) => [p.id, p.name, p.client_id]))
    .toEqual(expect.arrayContaining([[kept.id, 'Website', null], [moved.id, 'Website (Acme)', null]]));
  expect(projects).toHaveLength(2);
});

// Reports keeps its own hue; the other pages that a phone keeps under More take More's hue in the
// sidebar too.
test('the sidebar fills the current page in its section hue and main carries that section', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const pages = [['Timer', 'timer'], ['Pomodoro', 'pomodoro'], ['Reports', 'reports'], ['Projects', 'projects'], ['Clients', 'more'], ['Tags', 'more'], ['Trash', 'more'], ['Settings', 'settings']] as const;
  for (const [name, section] of [...pages, pages[0]]) {
    const link = nav.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await expectSectionHue(page, link, section);
  }
});

test('logging out from the menu and from settings ends the session', async ({ page }) => {
  await login(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect((await page.request.get('/api/v9/me')).status()).toBe(403);

  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('#session').getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect((await page.request.get('/api/v9/me')).status()).toBe(403);
});

test('JSON restore reports what it cannot import and takes a running entry once the timer stops', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Running here');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();

  const backup = await (await page.request.get('/api/app/export.json')).json();
  backup.time_entries = [
    { id: 9001, description: 'Running there', start: '2025-05-05T09:00:00Z', stop: null },
    { id: 9002, description: 'Missing project', start: '2025-05-06T09:00:00Z', stop: '2025-05-06T10:00:00Z', project_id: 424242 },
    { id: 9003, description: 'No zone', start: '2025-05-07T09:00:00', stop: '2025-05-07T10:00:00Z' },
    { id: 9004, description: 'No such day', start: '2025-02-28T09:00:00Z', stop: '2025-02-30T10:00:00Z' },
    { id: 9005, description: 'Fine', start: '2025-05-08T09:00:00Z', stop: '2025-05-08T10:00:00Z' },
  ];
  const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) };
  const summary = page.locator('.import-summary');
  const upload = async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
  };

  await upload();
  await expect(summary).toContainText('1 entry to add');
  await expect(summary).toContainText('4 problems');
  await summary.getByText('Problems', { exact: true }).click();
  const problems = summary.locator('.import-errors li');
  await expect(problems).toHaveCount(4);
  await expect(problems.filter({ hasText: 'time_entry 9001:' })).toContainText('Another timer is running here');
  await expect(problems.filter({ hasText: 'time_entry 9002:' })).toContainText('Its project 424242 was not imported');
  await expect(problems.filter({ hasText: 'time_entry 9003:' })).toContainText('Invalid start: expected an RFC 3339 timestamp');
  await expect(problems.filter({ hasText: 'time_entry 9004:' })).toContainText('Invalid stop: expected an RFC 3339 timestamp');

  await page.getByRole('link', { name: 'Timer' }).click();
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await upload();
  await expect(summary).toContainText('2 entries to add');
  await expect(summary).toContainText('3 problems');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(summary).toContainText('2 entries added');

  // Restoring the same file again adds nothing, the running entry included.
  await upload();
  await expect(summary).toContainText('0 entries to add');
  await expect(summary).toContainText('2 already here, skipped');
});
