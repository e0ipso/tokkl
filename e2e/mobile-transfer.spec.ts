import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { expectEmptyAccount, readAccount, recentDate, transferFixture, type Account } from './transfer-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, tap, tapDownload, tapNav, tapUpload } from './mobile-tests-helpers.ts';

test.use(PHONE);

/** The account without server-assigned IDs and totals, so a restored copy compares equal. */
function portable(account: Account) {
  return {
    entries: account.entries.map((e) => [e.description, e.start, e.stop, e.billable, e.project_name, e.client_name, e.task_name, [...e.tags].sort()]),
    projects: account.projects.map((p) => [p.name, p.client_name, p.billable, p.color]),
    clients: account.clients.map((c) => [c.name, c.notes]),
    tags: account.tags,
    tasks: account.tasks.map((t) => [t.name, t.project_name, t.active]),
  };
}

test('Toggl CSV import, JSON export and JSON restore finish by touch on a phone with the desktop results', async ({ page, data }) => {
  const recent = recentDate();
  await login(page);
  await tapNav(page, 'Settings');
  const csvSummary = page.locator('.import-summary').first();

  // The same Toggl CSV file the desktop import scenario uses.
  await tapUpload(page, page.locator('label.file-button', { hasText: 'Choose CSV file' }), transferFixture('toggl-detailed.csv', { RECENT_DATE: recent }));
  await expect(csvSummary).toContainText('5 entries to import');
  await expectNoPageOverflow(page);
  await tap(page.getByRole('button', { name: 'Import 5 entries' }));
  await expect(csvSummary).toContainText('5 entries imported');

  const imported = await readAccount(page, data.workspaceId);
  // What e2e/transfer-csv.spec.ts expects from this file on the desktop.
  expect(imported.entries.map((e) => [e.description, e.project_name, e.client_name, e.task_name, e.tags])).toEqual([
    ['Homepage wireframes', 'Website', 'Acme', 'Design', ['client-work', 'ux']],
    ['No project', null, null, null, []],
    ['Night deploy', 'Internal', null, 'Ops', ['ops']],
    ['Launch review', 'Website', 'Acme', null, ['ux']],
    ['Recent import', 'Website', 'Acme', 'Design', ['ops']],
  ]);
  expect(imported.projects.map((p) => [p.name, p.client_name, p.actual_seconds])).toEqual([
    ['Internal', null, 3 * 3600],
    ['Website', 'Acme', 5400 + 3600 + 4500],
  ]);

  // The timer list shows the recent row without a reload.
  await tapNav(page, 'Timer');
  const row = page.locator('.entry-line', { has: page.locator('input[value="Recent import"]') });
  await expect(row.locator('.project-label')).toContainText('Website');

  await tapNav(page, 'Settings');
  const exported = await tapDownload(page, page.getByRole('button', { name: 'Export JSON' }));
  expect(exported.filename).toMatch(/^tokkl-\d{4}-\d{2}-\d{2}\.json$/);
  expect((JSON.parse(exported.text) as { time_entries: unknown[] }).time_entries).toHaveLength(5);

  // Empty the account, then restore the exported file through the phone controls.
  await data.reset();
  await expectEmptyAccount(page, data.workspaceId);
  await tapUpload(page, page.locator('label.file-button', { hasText: 'Choose JSON file' }), {
    name: exported.filename, mimeType: 'application/json', buffer: Buffer.from(exported.text),
  });
  const jsonSummary = page.locator('.import-summary').last();
  await expect(jsonSummary).toContainText('5 entries to add');
  await expectFits(jsonSummary);
  await tap(page.getByRole('button', { name: 'Restore', exact: true }));
  await expect(jsonSummary).toContainText('5 entries added');
  await expectNoPageOverflow(page);

  expect(portable(await readAccount(page, data.workspaceId))).toEqual(portable(imported));
});
