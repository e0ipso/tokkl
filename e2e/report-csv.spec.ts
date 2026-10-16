import type { Page, Request } from '@playwright/test';
import { currentAccount } from './fixtures.ts';
import { cellTexts, downloadCsv, expect, hms, parseCsv, test, toSeconds } from './report-tests-helpers.ts';
import { login } from './helpers.ts';

const DETAILED_HEADER = [
  'User', 'Email', 'Client', 'Project', 'Task', 'Description', 'Billable',
  'Start date', 'Start time', 'End date', 'End time', 'Duration', 'Tags',
];

const totalTime = (page: Page) => page.locator('.report-totals div', { hasText: 'Total time' }).locator('dd');
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Report type' }).getByRole('tab', { name });

/** The CSV writes "(none)" where the page writes "Without project", "Without client" and so on. */
const csvTitle = (title: string) => (title.startsWith('Without ') ? '(none)' : title);

/** Waits for the next POST to an app CSV route and returns its JSON body. */
async function csvRequest(page: Page, kind: 'detailed' | 'summary'): Promise<Record<string, unknown>> {
  const request: Request = await page.waitForRequest((candidate) =>
    candidate.method() === 'POST' && new URL(candidate.url()).pathname === `/api/app/report/${kind}.csv`);
  return request.postDataJSON() as Record<string, unknown>;
}

test('filtered, rounded CSV downloads over more than a year match the displayed reports', async ({ page, api }) => {
  // The workspace rounds every entry up to 15 minutes; the report and its CSVs must agree.
  await api.setWorkspace({ rounding: 1, rounding_minutes: 15 });
  const acme = await api.client('ACME');
  const alpha = await api.project({ name: 'Alpha', client_id: acme });
  const beta = await api.project({ name: 'Beta' });
  // Kept: 7 min, 1 min, 29 min and 2 h 44 min 30 s, rounded up to 15 min, 15 min, 30 min and 2 h 45 min.
  await api.entry({ description: 'Kickoff', project_id: alpha, billable: true, tags: ['scope'], start: '2024-06-03T08:00:00Z', stop: '2024-06-03T08:07:00Z' });
  await api.entry({ description: 'Admin', start: '2025-08-15T10:00:00Z', stop: '2025-08-15T10:01:00Z' });
  await api.entry({ description: 'Review', project_id: alpha, tags: ['scope'], start: '2025-11-11T10:00:00Z', stop: '2025-11-11T10:29:00Z' });
  await api.entry({ description: 'Wrap up', project_id: alpha, start: '2026-01-20T10:00:00Z', stop: '2026-01-20T12:44:30Z' });
  // Dropped: tagged "invoiced", on project Beta, or before the range.
  await api.entry({ description: 'Year end', project_id: alpha, tags: ['invoiced'], start: '2024-12-31T10:00:00Z', stop: '2024-12-31T10:52:00Z' });
  await api.entry({ description: 'Research', project_id: beta, start: '2025-03-10T10:00:00Z', stop: '2025-03-10T11:20:00Z' });
  await api.entry({ description: 'Too early', project_id: alpha, start: '2024-05-31T10:00:00Z', stop: '2024-05-31T11:00:00Z' });
  const invoiced = await api.tagId('invoiced');

  await login(page);
  await page.goto(`/reports?from=2024-06-01&to=2026-01-31&group=clients&sub=projects&projects=not.${beta}&tags=not.${invoiced}`);
  await expect(totalTime(page)).toHaveText('3:45:00');
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  for (const title of ['ACME', 'Without client']) {
    await breakdown.getByRole('button', { name: `Show project breakdown for ${title}` }).click();
  }
  // Group rows, each followed by its sub-group rows: [title, duration, share].
  const readShownRows = async () => {
    const shown = await cellTexts(breakdown.locator('tbody tr'));
    const rowsOnScreen: string[][] = [];
    let group = '';
    for (const [index, cells] of shown.entries()) {
      const isGroup = await breakdown.locator('tbody tr').nth(index).evaluate((row) => row.classList.contains('group-row'));
      if (isGroup) group = cells[0]!;
      else rowsOnScreen.push([csvTitle(group), csvTitle(cells[0]!), cells[1]!]);
    }
    return rowsOnScreen;
  };
  const shownRows = [['ACME', 'Alpha', '3:30:00'], ['(none)', '(none)', '0:15:00']];
  await expect.poll(readShownRows).toEqual(shownRows);

  const summaryBody = csvRequest(page, 'summary');
  const summary = await downloadCsv(page, 'CSV (summary)');
  expect(await summaryBody).toMatchObject({
    start_date: '2024-06-01', end_date: '2026-01-31', exclude_project_ids: [beta], exclude_tag_ids: [invoiced],
    grouping: 'clients', sub_grouping: 'projects',
  });
  expect(summary.filename).toBe('tokkl-summary-2024-06-01-to-2026-01-31.csv');
  expect(summary.rows).toEqual([['Group', 'Sub group', 'Duration'], ...shownRows]);
  expect(hms(summary.rows.slice(1).reduce((sum, row) => sum + toSeconds(row[2]!), 0))).toBe('3:45:00');

  await tab(page, 'Detailed').click();
  const rows = page.locator('tr.entry-row');
  /** Displayed rows as [date, description, project, client, tags, duration], CSV spelling. */
  const displayed = async () => (await cellTexts(rows)).map((cells) =>
    [cells[0]!, cells[1]!, cells[2] === 'Without project' ? '' : cells[2]!, cells[3]!, cells[4]!, cells[6]!]);
  /** CSV rows in the same shape: Start date, Description, Project, Client, Tags, Duration. */
  const exported = (csv: string[][]) => csv.slice(1).map((row) => [row[7]!, row[5]!, row[3]!, row[2]!, row[12]!, row[11]!]);

  await expect(rows).toHaveCount(4);
  const byDate = await displayed();
  expect(byDate.map((row) => [row[1], row[5]])).toEqual([
    ['Wrap up', '2:45:00'], ['Review', '0:30:00'], ['Admin', '0:15:00'], ['Kickoff', '0:15:00'],
  ]);
  const detailedBody = csvRequest(page, 'detailed');
  const detailed = await downloadCsv(page, 'CSV (detailed)');
  expect(await detailedBody).toMatchObject({
    start_date: '2024-06-01', end_date: '2026-01-31', exclude_project_ids: [beta], exclude_tag_ids: [invoiced], sort: 'date', dir: 'desc',
  });
  expect(detailed.filename).toBe('tokkl-detailed-2024-06-01-to-2026-01-31.csv');
  expect(detailed.rows[0]).toEqual(DETAILED_HEADER);
  expect(exported(detailed.rows)).toEqual(byDate);
  const { fullname, email } = currentAccount();
  expect(detailed.rows.slice(1).map((row) => [row[0], row[1], row[8], row[10]])).toEqual([
    [fullname, email, '11:00:00', '13:44:30'],
    [fullname, email, '11:00:00', '11:29:00'],
    [fullname, email, '12:00:00', '12:01:00'],
    [fullname, email, '10:00:00', '10:07:00'],
  ]);
  expect(hms(detailed.rows.slice(1).reduce((sum, row) => sum + toSeconds(row[11]!), 0))).toBe('3:45:00');

  // The detailed CSV follows the sort on screen.
  await page.getByRole('columnheader', { name: 'Duration' }).getByRole('button').click();
  await expect(rows.first()).toContainText('Wrap up');
  await page.getByRole('columnheader', { name: 'Duration' }).getByRole('button').click();
  await expect(rows.last()).toContainText('Wrap up');
  const byDuration = await displayed();
  const sorted = await downloadCsv(page, 'CSV (detailed)');
  expect(exported(sorted.rows)).toEqual(byDuration);
});

test('Toggl compatibility CSV exports keep their 366-day cap while the app exports do not', async ({ api }) => {
  await api.setWorkspace({ rounding: 1, rounding_minutes: 15 });
  await api.entry({ description: 'Seven minutes', start: '2025-06-02T08:00:00Z', stop: '2025-06-02T08:07:00Z' });
  const v3 = `/reports/api/v3/workspace/${api.workspaceId}`;
  const year = { start_date: '2025-01-01', end_date: '2026-01-01' };
  const tooLong = { start_date: '2025-01-01', end_date: '2026-01-02' };

  for (const path of [`${v3}/search/time_entries.csv`, `${v3}/summary/time_entries.csv`]) {
    expect((await api.rawPost(path, year)).status(), `${path} over 366 days`).toBe(200);
    const refused = await api.rawPost(path, tooLong);
    expect(refused.status(), `${path} over 367 days`).toBe(400);
    expect(await refused.text()).toContain('Maximum allowed date range is 366 days');
  }
  // Toggl rounds only when asked; the app export always applies the workspace rounding.
  const compat = parseCsv(await (await api.rawPost(`${v3}/search/time_entries.csv`, year)).text());
  expect(compat[1]![11]).toBe('0:07:00');
  const asked = parseCsv(await (await api.rawPost(`${v3}/search/time_entries.csv`, { ...year, rounding: 1 })).text());
  expect(asked[1]![11]).toBe('0:15:00');

  const longer = { start_date: '2016-02-01', end_date: '2026-01-31' };
  for (const kind of ['detailed', 'summary']) {
    const response = await api.rawPost(`/api/app/report/${kind}.csv`, longer);
    expect(response.status(), `app ${kind} CSV over ${longer.start_date}..${longer.end_date}`).toBe(200);
    const rows = parseCsv(await response.text());
    expect(rows).toHaveLength(2);
    expect(kind === 'detailed' ? rows[1]![11] : rows[1]![2]).toBe('0:15:00');
  }
});
