import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import {
  accountTime, chooseCsv, expectEmptyAccount, openSettings, readAccount, recentDate, transferFixture,
} from './transfer-tests-helpers.ts';

test('Toggl CSV preview and cancel write nothing; import saves account-time entries once and refreshes the UI', async ({ page, data }) => {
  const recent = recentDate();
  const csv = transferFixture('toggl-detailed.csv', { RECENT_DATE: recent });
  await login(page);

  // Load the timer list and projects first, so seeing the import later proves the cache refreshed.
  await expect(page.locator('.entry-line')).toHaveCount(0);
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('cell', { name: 'Website' })).toHaveCount(0);

  await openSettings(page);
  const summary = page.locator('.import-summary').first();
  const importButton = page.getByRole('button', { name: /^Import \d+ entr/ });

  // Preview, then cancel: the summary describes the file and nothing is written.
  await chooseCsv(page, csv);
  await expect(summary).toContainText('5 rows in the file');
  await expect(summary).toContainText('5 entries to import');
  await expect(summary).toContainText('0 already here, skipped');
  await expect(summary).toContainText('New projects: Website (Acme), Internal');
  await expect(summary).toContainText('New clients: Acme');
  await expect(importButton).toHaveText(/Import 5 entries/);
  await expectEmptyAccount(page, data.workspaceId);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.import-summary')).toHaveCount(0);
  await expect(importButton).toHaveCount(0);
  await expectEmptyAccount(page, data.workspaceId);

  // Preview again and import.
  await chooseCsv(page, csv);
  await expect(summary).toContainText('5 entries to import');
  await importButton.click();
  await expect(summary).toContainText('5 entries imported');
  await expect(summary).toContainText('Created projects: Website (Acme), Internal');
  await expect(page.getByRole('status')).toContainText('Imported 5 entries');
  await expect(importButton).toHaveCount(0);

  const account = await readAccount(page, data.workspaceId);
  expect(account.entries.map((e) => ({
    description: e.description, start: e.start, stop: e.stop, billable: e.billable,
    project: e.project_name, client: e.client_name, task: e.task_name, tags: e.tags,
  }))).toEqual([
    {
      description: 'Homepage wireframes', start: accountTime('2026-01-15', '09:00:00'), stop: accountTime('2026-01-15', '10:30:00'),
      billable: true, project: 'Website', client: 'Acme', task: 'Design', tags: ['client-work', 'ux'],
    },
    {
      description: 'No project', start: accountTime('2026-02-02', '14:00:00'), stop: accountTime('2026-02-02', '14:45:00'),
      billable: false, project: null, client: null, task: null, tags: [],
    },
    {
      // Crosses the spring-forward night: 23:30 CET to 03:30 CEST is three hours.
      description: 'Night deploy', start: '2026-03-28T22:30:00+00:00', stop: '2026-03-29T01:30:00+00:00',
      billable: false, project: 'Internal', client: null, task: 'Ops', tags: ['ops'],
    },
    {
      description: 'Launch review', start: '2026-07-15T07:00:00+00:00', stop: '2026-07-15T08:00:00+00:00',
      billable: false, project: 'Website', client: 'Acme', task: null, tags: ['ux'],
    },
    {
      description: 'Recent import', start: accountTime(recent, '10:00:00'), stop: accountTime(recent, '11:15:00'),
      billable: true, project: 'Website', client: 'Acme', task: 'Design', tags: ['ops'],
    },
  ]);
  expect(account.projects.map((p) => [p.name, p.client_name, p.actual_seconds])).toEqual([
    ['Internal', null, 3 * 3600],
    ['Website', 'Acme', 5400 + 3600 + 4500],
  ]);
  expect(account.clients.map((c) => c.name)).toEqual(['Acme']);
  expect(account.tags).toEqual(['client-work', 'ops', 'ux']);
  expect(account.tasks.map((t) => [t.name, t.project_name])).toEqual([['Design', 'Website'], ['Ops', 'Internal']]);
  const website = account.projects.find((p) => p.name === 'Website')!;
  const design = account.tasks.find((t) => t.name === 'Design')!;
  expect(account.entries.filter((e) => e.task_id === design.id).every((e) => e.project_id === website.id)).toBe(true);

  // The app shows the imported data without a reload.
  await page.getByRole('link', { name: 'Projects' }).click();
  const websiteRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Website', exact: true }) });
  await expect(websiteRow).toContainText('Acme');
  await expect(websiteRow).toContainText('3:45:00');
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Internal', exact: true }) })).toContainText('3:00:00');
  await page.getByRole('link', { name: 'Timer' }).click();
  const row = page.locator('.entry-line').filter({ has: page.locator('input[value="Recent import"]') });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.project-label')).toContainText('Website');
  await expect(row.locator('.tag-chip')).toHaveText('ops');
  await expect(row.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');

  // The same file again finds every row already here.
  await openSettings(page);
  await chooseCsv(page, csv);
  await expect(summary).toContainText('0 entries to import');
  await expect(summary).toContainText('5 already here, skipped');
  await expect(importButton).toBeDisabled();
  const again = await readAccount(page, data.workspaceId);
  expect(again.entries.map((e) => e.id)).toEqual(account.entries.map((e) => e.id));
  expect(again.projects.map((p) => p.id)).toEqual(account.projects.map((p) => p.id));
  expect(again.tasks.map((t) => t.id)).toEqual(account.tasks.map((t) => t.id));
});

test('Toggl CSV rows with problems show their reasons and the valid rows still import', async ({ page, data, runtimeErrors }) => {
  await login(page);
  await openSettings(page);
  const summary = page.locator('.import-summary').first();
  const problems = summary.locator('.import-errors li');
  const reasons = [
    'Row 3: Invalid start date or time',
    'Row 4: Invalid start date or time',
    'Row 5: Invalid end time or duration',
    'Row 6: Stop time must be after start time',
  ];

  await chooseCsv(page, transferFixture('toggl-malformed.csv'));
  await expect(summary).toContainText('6 rows in the file');
  await expect(summary).toContainText('2 entries to import');
  await expect(summary).toContainText('4 rows with problems');
  await expect(summary.locator('.import-errors summary')).toHaveText('4 problems');
  await expect(problems).toHaveText(reasons);
  await expectEmptyAccount(page, data.workspaceId);

  await page.getByRole('button', { name: 'Import 2 entries' }).click();
  await expect(summary).toContainText('2 entries imported');
  await expect(problems).toHaveText(reasons);
  const account = await readAccount(page, data.workspaceId);
  expect(account.entries.map((e) => [e.description, e.start, e.project_name])).toEqual([
    ['Valid first', accountTime('2026-05-04', '09:00:00'), 'Internal'],
    ['Valid last', accountTime('2026-05-06', '09:00:00'), 'Internal'],
  ]);
  expect(account.projects.map((p) => p.name)).toEqual(['Internal']);

  // A file without the Toggl columns is refused as a whole, with the reason in a toast.
  runtimeErrors.allowResponse({
    status: 400, method: 'POST', path: /^\/api\/app\/import\/toggl-csv$/,
    reason: 'the scenario uploads a CSV without the Toggl detailed-report columns',
  });
  await chooseCsv(page, { name: 'not-toggl.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,When\nSomething,today\n') });
  await expect(page.getByRole('status')).toContainText('Missing "Start date" and "Start time" columns');
  await expect(page.locator('.import-summary')).toHaveCount(0);
  expect((await readAccount(page, data.workspaceId)).entries).toHaveLength(2);
});

// TT-0131: a team export lists its Toggl users, needs a choice, and imports only the chosen rows.
// TT-0154: User "Alice <alice@example.com>" with no Email and User "Alice" with that Email are two users.
test('a Toggl CSV from several users imports only the users picked in the preview', async ({ page, data }) => {
  await login(page);
  await openSettings(page);
  const summary = page.locator('.import-summary').first();
  const picker = page.getByRole('group', { name: 'This file has entries from 3 Toggl users. Choose whose entries to import.' });
  const sam = picker.getByRole('checkbox', { name: 'Sam Synthetic sam@example.com · 2 rows', exact: true });
  const aliceByName = picker.getByRole('checkbox', { name: 'Alice <alice@example.com> · 1 row', exact: true });
  const aliceByEmail = picker.getByRole('checkbox', { name: 'Alice alice@example.com · 1 row', exact: true });

  // Before anyone is picked the preview counts every row, and the import waits for a choice.
  await chooseCsv(page, transferFixture('toggl-team.csv'));
  await expect(picker.getByRole('checkbox')).toHaveCount(3);
  for (const box of [sam, aliceByName, aliceByEmail]) await expect(box).not.toBeChecked();
  await expect(summary).toContainText('4 entries to import');
  await expect(page.getByRole('button', { name: 'Import 4 entries' })).toBeDisabled();

  // Each pick previews again, so the counts describe only the chosen users' rows.
  await sam.check();
  await expect(summary).toContainText('2 entries to import');
  await expect(summary).toContainText('2 rows from other Toggl users, skipped');
  await aliceByEmail.check();
  await expect(summary).toContainText('3 entries to import');
  await expect(summary).toContainText('1 row from other Toggl users, skipped');
  await expectEmptyAccount(page, data.workspaceId);

  await page.getByRole('button', { name: 'Import 3 entries' }).click();
  await expect(summary).toContainText('3 entries imported');
  await expect(summary).toContainText('1 row from other Toggl users, skipped');
  await expect(picker).toHaveCount(0);
  const account = await readAccount(page, data.workspaceId);
  expect(account.entries.map((e) => [e.description, e.start, e.project_name])).toEqual([
    ['Sam first', accountTime('2026-04-06', '09:00:00'), 'Website'],
    ['Alice with an email', accountTime('2026-04-07', '09:00:00'), 'Website'],
    ['Sam second', accountTime('2026-04-07', '10:00:00'), 'Internal'],
  ]);
});
