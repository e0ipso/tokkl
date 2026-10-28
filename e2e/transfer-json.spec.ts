import { expect, test } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { chooseJson, expectEmptyAccount, openSettings, readAccount, transferFixture } from './transfer-tests-helpers.ts';

test('JSON restore previews without writing, then restores missing entities with their metadata once', async ({ page, data }) => {
  const backup = transferFixture('restore-full.json');
  await login(page);
  // Load the lists first, so seeing the restore later proves the cache refreshed without a reload.
  for (const name of ['Projects', 'Clients', 'Tags']) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await openSettings(page);
  const summary = page.locator('.import-summary').last();
  const restore = page.getByRole('button', { name: 'Restore' });

  await chooseJson(page, backup);
  await expect(summary).toContainText('3 entries to add');
  await expect(summary).toContainText('3 projects, 2 clients, 2 tasks, 2 tags to add');
  await expect(summary).not.toContainText('problem');
  await expectEmptyAccount(page, data.workspaceId);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(restore).toHaveCount(0);
  await expectEmptyAccount(page, data.workspaceId);

  await chooseJson(page, backup);
  await expect(summary).toContainText('3 entries to add');
  await restore.click();
  await expect(summary).toContainText('3 entries added');
  await expect(summary).toContainText('3 projects, 2 clients, 2 tasks, 2 tags added');
  await expect(page.getByRole('status')).toContainText('Restored 3 entries');
  await expect(restore).toHaveCount(0);

  const account = await readAccount(page, data.workspaceId);
  expect(account.clients.map((c) => [c.name, c.notes, c.archived])).toEqual([['Acme', 'Main client', false], ['Dormant', null, true]]);
  expect(account.projects.map((p) => ({
    name: p.name, client: p.client_name, color: p.color, active: p.active, is_private: p.is_private, billable: p.billable,
    rate: p.rate, currency: p.currency, estimated_hours: p.estimated_hours, start_date: p.start_date, end_date: p.end_date,
  }))).toEqual([
    {
      name: 'Legacy', client: 'Dormant', color: '#2da608', active: false, is_private: true, billable: false,
      rate: null, currency: null, estimated_hours: null, start_date: '2019-03-04', end_date: '2019-12-31',
    },
    {
      name: 'Roadmap', client: null, color: '#0b83d9', active: true, is_private: true, billable: false,
      rate: null, currency: null, estimated_hours: null, start_date: '2030-05-01', end_date: null,
    },
    {
      name: 'Website', client: 'Acme', color: '#d92b2b', active: true, is_private: false, billable: true,
      rate: 85, currency: 'EUR', estimated_hours: 40, start_date: '2020-01-02', end_date: null,
    },
  ]);
  expect(account.projects.find((p) => p.name === 'Roadmap')!.status).toBe('upcoming');
  expect(account.tasks.map((t) => [t.name, t.project_name, t.estimated_seconds])).toEqual([['Cleanup', 'Legacy', null], ['Design', 'Website', 7200]]);
  expect(account.tags).toEqual(['ops', 'ux']);
  // The deleted entry in the file stays out; the others keep their instants, links and tags.
  expect(account.entries.map((e) => ({
    description: e.description, start: e.start, stop: e.stop, project: e.project_name, task: e.task_name, tags: e.tags, billable: e.billable,
  }))).toEqual([
    {
      description: 'Legacy cleanup', start: '2019-06-03T07:00:00+00:00', stop: '2019-06-03T09:00:00+00:00',
      project: 'Legacy', task: 'Cleanup', tags: ['ops'], billable: false,
    },
    {
      description: 'Wireframes', start: '2026-01-15T08:00:00+00:00', stop: '2026-01-15T09:30:00+00:00',
      project: 'Website', task: 'Design', tags: ['ux'], billable: true,
    },
    {
      description: 'Planning', start: '2026-07-15T07:00:00+00:00', stop: '2026-07-15T08:00:00+00:00',
      project: 'Roadmap', task: null, tags: ['ops', 'ux'], billable: false,
    },
  ]);

  // The management pages show the restored data without a reload.
  await page.getByRole('link', { name: 'Projects' }).click();
  const projectRow = (name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(projectRow('Website')).toContainText('Acme');
  await expect(projectRow('Website')).toContainText('1:30:00');
  await expect(projectRow('Roadmap')).toBeVisible();
  await expect(projectRow('Legacy')).toHaveCount(0);
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Archived' }).click();
  await expect(projectRow('Legacy')).toContainText('Dormant');
  await page.getByRole('link', { name: 'Clients' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Acme' })).toContainText('Main client');
  await page.getByRole('link', { name: 'Tags' }).click();
  await expect(page.locator('.tag-chip')).toHaveText(['ops', 'ux']);

  // Restoring the same file again adds nothing.
  await openSettings(page);
  await chooseJson(page, backup);
  await expect(summary).toContainText('0 entries to add');
  await expect(summary).toContainText('3 already here, skipped');
  await expect(summary).toContainText('0 projects, 0 clients, 0 tasks, 0 tags to add');
  await restore.click();
  await expect(summary).toContainText('0 entries added');
  const again = await readAccount(page, data.workspaceId);
  expect(again.entries.map((e) => e.id)).toEqual(account.entries.map((e) => e.id));
  expect(again.projects.map((p) => [p.id, p.active])).toEqual(account.projects.map((p) => [p.id, p.active]));
  expect(again.clients.map((c) => c.id)).toEqual(account.clients.map((c) => c.id));
  expect(again.tasks.map((t) => t.id)).toEqual(account.tasks.map((t) => t.id));
  expect(again.tags).toEqual(account.tags);
});

test('JSON restore skips and reports records with unresolved references and imports the independent ones', async ({ page, data }) => {
  const backup = transferFixture('restore-broken-refs.json');
  await login(page);
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await openSettings(page);
  const summary = page.locator('.import-summary').last();
  const problems = summary.locator('.import-errors li');
  const reasons = [
    'project 21: Its client 96 was not imported',
    'project 23: Invalid color: expected #rrggbb',
    'task 32: Its project 99 was not imported',
    "task 33: Task name can't be blank",
    'time_entry 61: Its project 98 was not imported',
    'time_entry 62: Its task 97 was not imported',
    'time_entry 63: Its tag 95 was not imported',
    'time_entry 64: Its project 21 was not imported',
  ];

  await chooseJson(page, backup);
  await expect(summary).toContainText('3 entries to add');
  await expect(summary).toContainText('2 projects, 1 client, 2 tasks, 1 tag to add');
  await expect(summary).toContainText('8 problems');
  await summary.getByText('Problems', { exact: true }).click();
  await expect(problems).toHaveText(reasons);
  await expectEmptyAccount(page, data.workspaceId);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(summary).toContainText('3 entries added');
  await expect(summary).toContainText('8 problems');
  await summary.getByText('Problems', { exact: true }).click();
  await expect(problems).toHaveText(reasons);

  const account = await readAccount(page, data.workspaceId);
  expect(account.projects.map((p) => [p.name, p.client_name, p.active])).toEqual([['Kept', 'Acme', true], ['Shelved', null, false]]);
  expect(account.tasks.map((t) => [t.name, t.project_name])).toEqual([['Build', 'Kept'], ['Sweep', 'Shelved']]);
  expect(account.tags).toEqual(['ux']);
  expect(account.entries.map((e) => [e.description, e.project_name, e.task_name, e.tags])).toEqual([
    ['Linked', 'Kept', 'Build', ['ux']],
    ['Explicit nulls', null, null, []],
    ['Shelved work', 'Shelved', 'Sweep', []],
  ]);

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Kept', exact: true }) })).toContainText('Acme');
  await expect(page.getByRole('cell', { name: 'Orphaned client' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Bad colour' })).toHaveCount(0);
});

test('JSON restore committed while a timer runs skips the running entry and keeps the timer', async ({ page, data }) => {
  const backup = transferFixture('restore-running.json');
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Running here');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  const running = await (await page.request.get('/api/v9/me/time_entries/current')).json();
  expect(running).toMatchObject({ description: 'Running here', stop: null });

  await openSettings(page);
  const summary = page.locator('.import-summary').last();
  const problems = summary.locator('.import-errors li');
  const conflict = 'time_entry 71: Another timer is running here. Stop it and restore again to import this running entry';
  const checkAccount = async () => {
    const current = await (await page.request.get('/api/v9/me/time_entries/current')).json();
    expect(current).toMatchObject({ id: running.id, description: 'Running here', start: running.start, stop: null });
    const account = await readAccount(page, data.workspaceId);
    // The restored entry is off the time resolution grid: a restore keeps the times in the file.
    expect(account.entries.map((e) => [e.description, e.start, e.stop])).toEqual([
      ['Stopped there', '2025-05-06T09:02:37+00:00', '2025-05-06T10:01:12+00:00'],
      ['Running here', running.start, null],
    ]);
  };

  for (const [added, skipped] of [[1, 0], [0, 1]] as const) {
    await chooseJson(page, backup);
    await expect(summary).toContainText(`${added} ${added === 1 ? 'entry' : 'entries'} to add`);
    await expect(summary).toContainText('1 problem');
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(summary).toContainText(`${added} ${added === 1 ? 'entry' : 'entries'} added`);
    await expect(summary).toContainText(`${skipped} already here, skipped`);
    await summary.getByText('Problems', { exact: true }).click();
    await expect(problems).toHaveText([conflict]);
    await checkAccount();
  }

  await page.getByRole('link', { name: 'Timer' }).click();
  await expect(timer.getByLabel('Description')).toHaveValue('Running here');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
});

// The backup records the account zone, so a no-time entry restored into a New York account keeps
// the Madrid date it was made on.
test('a no-time entry round-trips through the JSON backup into another account, and a second restore adds nothing', async ({ page, data, users }) => {
  await data.createEntry({ description: 'Standup', start: '2026-06-15T07:00:00Z', stop: '2026-06-15T08:00:00Z' });
  await data.createNoTimeEntry({ description: 'Admin chores', day: '2026-06-15', duration: 5400 });
  await login(page);
  const backup = await (await page.request.get('/api/app/export.json')).body();
  const chores = JSON.parse(backup.toString()).time_entries.find((e: { description: string }) => e.description === 'Admin chores');
  expect(chores).toMatchObject({ all_day: true, start: '2026-06-14T22:00:00+00:00', stop: '2026-06-14T23:30:00+00:00' });

  const fresh = await users.create({ timezone: 'America/New_York' });
  await page.context().clearCookies();
  await loginAs(page, fresh.account);
  await expectEmptyAccount(page, fresh.workspaceId);
  await openSettings(page);
  const summary = page.locator('.import-summary').last();
  const restore = page.getByRole('button', { name: 'Restore' });
  const file = { name: 'tokkl-backup.json', mimeType: 'application/json', buffer: backup };
  await chooseJson(page, file);
  await expect(summary).toContainText('2 entries to add');
  await restore.click();
  await expect(summary).toContainText('2 entries added');

  const restored = async () => (await readAccount(page, fresh.workspaceId)).entries.map((e) => ({
    description: e.description, all_day: e.all_day, start: e.start, stop: e.stop,
  }));
  // New York is on summer time, four hours behind UTC: the no-time entry starts at its local midnight.
  const expected = [
    { description: 'Admin chores', all_day: true, start: '2026-06-15T04:00:00+00:00', stop: '2026-06-15T05:30:00+00:00' },
    { description: 'Standup', all_day: false, start: '2026-06-15T07:00:00+00:00', stop: '2026-06-15T08:00:00+00:00' },
  ];
  expect(await restored()).toEqual(expected);

  await chooseJson(page, file);
  await expect(summary).toContainText('0 entries to add');
  await expect(summary).toContainText('2 already here, skipped');
  await restore.click();
  await expect(summary).toContainText('0 entries added');
  expect(await restored()).toEqual(expected);
});
