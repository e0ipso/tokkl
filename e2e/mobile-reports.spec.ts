import type { Page } from '@playwright/test';
import { cellTexts, expect, parseCsv, test } from './report-tests-helpers.ts';
import { login } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, tap, tapDownload, tapOutside } from './mobile-tests-helpers.ts';

test.use(PHONE);

const totalTime = (page: Page) => page.locator('.report-totals div', { hasText: 'Total time' }).locator('dd');

/** Opens a filter chip, picks the named options and then "Is not", and closes it with a tap outside. */
async function exclude(page: Page, label: string, options: string[]): Promise<void> {
  const filters = page.getByRole('group', { name: 'Filters' });
  await tap(filters.getByRole('button', { name: label }));
  const popover = page.getByRole('dialog').filter({ has: page.getByLabel(`Find ${label.toLowerCase()}`) });
  await expectFits(popover);
  for (const option of options) {
    await tap(popover.locator('label.picker-check', { hasText: option }));
    await expect(popover.getByRole('checkbox', { name: option })).toBeChecked();
  }
  // Options first, then "Is not"; the scenario below covers the reverse order.
  const isNot = popover.getByRole('group', { name: `${label} filter mode` }).getByRole('button', { name: 'Is not' });
  await tap(isNot);
  await expect(isNot).toHaveAttribute('aria-pressed', 'true');
  await tapOutside(page.getByRole('heading', { name: 'Reports', level: 1 }));
  await expect(popover).toBeHidden();
}

test('report filters, tabs and CSV downloads work by touch on a phone and match the desktop export', async ({ page, api }) => {
  const acme = await api.client('ACME');
  const alpha = await api.project({ name: 'Alpha', client_id: acme });
  const beta = await api.project({ name: 'Beta' });
  await api.entry({ description: 'Kickoff', project_id: alpha, billable: true, tags: ['scope'], start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z' });
  await api.entry({ description: 'Review', project_id: alpha, start: '2026-01-07T09:00:00Z', stop: '2026-01-07T09:30:00Z' });
  // Dropped by the filters below: project Beta, or tagged "invoiced".
  await api.entry({ description: 'Research', project_id: beta, start: '2026-01-06T09:00:00Z', stop: '2026-01-06T11:00:00Z' });
  await api.entry({ description: 'Billed', project_id: alpha, tags: ['invoiced'], start: '2026-01-08T09:00:00Z', stop: '2026-01-08T09:45:00Z' });
  const invoiced = await api.tagId('invoiced');

  await login(page);
  await page.goto('/reports?from=2026-01-05&to=2026-01-11');
  await expect(totalTime(page)).toHaveText('4:15:00');
  await expectNoPageOverflow(page);

  await exclude(page, 'Project', ['Beta']);
  await exclude(page, 'Tag', ['invoiced']);
  await expect(totalTime(page)).toHaveText('1:30:00');
  const search = new URL(page.url()).searchParams;
  expect([search.get('projects'), search.get('tags')]).toEqual([`not.${beta}`, `not.${invoiced}`]);
  const filters = page.getByRole('group', { name: 'Filters' });
  await expect(filters.getByRole('button', { name: /Project.*not Beta/ })).toBeVisible();
  await expect(filters.getByRole('button', { name: /Tag.*not invoiced/ })).toBeVisible();
  await expectNoPageOverflow(page);

  // Summary CSV, with the same request filters the desktop sends.
  const summary = await tapDownload(page, page.getByRole('group', { name: 'Export' }).getByRole('button', { name: 'CSV (summary)' }));
  expect(summary.filename).toBe('timetrack-summary-2026-01-05-to-2026-01-11.csv');
  expect(parseCsv(summary.text)).toEqual([
    ['Group', 'Sub group', 'Duration'],
    ['Alpha', 'Kickoff', '1:00:00'],
    ['Alpha', 'Review', '0:30:00'],
  ]);

  await tap(page.getByRole('tablist', { name: 'Report type' }).getByRole('tab', { name: 'Detailed' }));
  const rows = page.locator('tr.entry-row');
  await expect(rows).toHaveCount(2);
  await expectNoPageOverflow(page);
  const shown = (await cellTexts(rows)).map((cells) => [cells[1], cells[2], cells[3], cells[4], cells[6]]);
  expect(shown).toEqual([
    ['Review', 'Alpha', 'ACME', '', '0:30:00'],
    ['Kickoff', 'Alpha', 'ACME', 'scope', '1:00:00'],
  ]);
  const detailed = await tapDownload(page, page.getByRole('group', { name: 'Export' }).getByRole('button', { name: 'CSV (detailed)' }));
  expect(detailed.filename).toBe('timetrack-detailed-2026-01-05-to-2026-01-11.csv');
  // Description, Project, Client, Tags, Duration: the same rows the screen shows.
  expect(parseCsv(detailed.text).slice(1).map((row) => [row[5], row[3], row[2], row[12], row[11]])).toEqual(shown);

  // A wide table scrolls inside its wrapper, so its last column is reachable by touch.
  const lastCell = rows.first().locator('td').last();
  await expectFits(lastCell);
  await expectNoPageOverflow(page);
});

test('choosing "Is not" before picking a project excludes the project picked next', async ({ page, api }) => {
  const alpha = await api.project({ name: 'Alpha' });
  const beta = await api.project({ name: 'Beta' });
  await api.entry({ description: 'Kickoff', project_id: alpha, start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z' });
  await api.entry({ description: 'Research', project_id: beta, start: '2026-01-06T09:00:00Z', stop: '2026-01-06T11:00:00Z' });

  await login(page);
  await page.goto('/reports?from=2026-01-05&to=2026-01-11');
  await expect(totalTime(page)).toHaveText('3:00:00');
  await tap(page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Project' }));
  const popover = page.getByRole('dialog').filter({ has: page.getByLabel('Find project') });
  const isNot = popover.getByRole('group', { name: 'Project filter mode' }).getByRole('button', { name: 'Is not' });
  await tap(isNot);
  await expect(isNot).toHaveAttribute('aria-pressed', 'true');
  await tap(popover.locator('label.picker-check', { hasText: 'Beta' }));
  await expect(isNot).toHaveAttribute('aria-pressed', 'true');
  await tapOutside(page.getByRole('heading', { name: 'Reports', level: 1 }));
  expect(new URL(page.url()).searchParams.get('projects')).toBe(`not.${beta}`);
  await expect(totalTime(page)).toHaveText('1:00:00');
});
