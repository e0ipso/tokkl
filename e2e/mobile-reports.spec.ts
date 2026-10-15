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
  // TT-0092: the filters, range control, tabs, totals and the summary table fit the screen.
  const tabs = page.getByRole('tablist', { name: 'Report type' });
  await expectFits(page.getByRole('group', { name: 'Filters' }));
  await expectFits(page.locator('.range-control'));
  await expectFits(tabs);
  await expectFits(page.locator('.report-totals'));
  await expect(page.locator('.breakdown-table tbody tr').first()).toBeVisible();
  await expectFits(page.getByRole('region', { name: 'Breakdown' }).locator('.table-wrap'));

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
  expect(summary.filename).toBe('tokkl-summary-2026-01-05-to-2026-01-11.csv');
  expect(parseCsv(summary.text)).toEqual([
    ['Group', 'Sub group', 'Duration'],
    ['Alpha', 'Kickoff', '1:00:00'],
    ['Alpha', 'Review', '0:30:00'],
  ]);

  await tap(tabs.getByRole('tab', { name: 'Detailed' }));
  const rows = page.locator('tr.entry-row');
  await expect(rows).toHaveCount(2);
  await expectNoPageOverflow(page);
  const shown = (await cellTexts(rows)).map((cells) => [cells[1], cells[2], cells[3], cells[4], cells[6]]);
  expect(shown).toEqual([
    ['Review', 'Alpha', 'ACME', '', '0:30:00'],
    ['Kickoff', 'Alpha', 'ACME', 'scope', '1:00:00'],
  ]);
  const detailed = await tapDownload(page, page.getByRole('group', { name: 'Export' }).getByRole('button', { name: 'CSV (detailed)' }));
  expect(detailed.filename).toBe('tokkl-detailed-2026-01-05-to-2026-01-11.csv');
  // Description, Project, Client, Tags, Duration: the same rows the screen shows.
  expect(parseCsv(detailed.text).slice(1).map((row) => [row[5], row[3], row[2], row[12], row[11]])).toEqual(shown);

  // A wide table scrolls inside its wrapper, so its last column is reachable by touch.
  const lastCell = rows.first().locator('td').last();
  await expectFits(lastCell);
  await expectFits(page.locator('.table-wrap', { has: page.locator('.detailed-table') }));
  await expectNoPageOverflow(page);

  await tap(tabs.getByRole('tab', { name: 'Weekly' }));
  await expect(page.locator('.weekly-table tbody tr').first()).toBeVisible();
  await expectFits(page.locator('.table-wrap', { has: page.locator('.weekly-table') }));
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

// TT-0118: on a phone the browser squeezed every wrappable column of the wide detailed table, so the
// client wrapped one word per line and the tags one chip per line, and short rows grew to about 80px.
// Client and tags now stay on one line (about 40px rows); a long client is cut off with an ellipsis
// and keeps its full name in the title, as does the project name.
test('detailed rows stay one line tall on a phone, with long names cut off and kept in the title', async ({ page, api }) => {
  const shortClient = await api.client('Acme Widget Co');
  const longClient = await api.client('Northwind Traders International Holdings Group');
  const website = await api.project({ name: 'Website Redesign Phase Two', client_id: longClient });
  const intranet = await api.project({ name: 'Intranet', client_id: shortClient });
  await api.entry({ description: 'Wireframes', project_id: website, tags: ['design review', 'scope', 'urgent'], start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z' });
  await api.entry({ description: 'Wiki', project_id: intranet, tags: ['docs'], start: '2026-01-06T09:00:00Z', stop: '2026-01-06T09:30:00Z' });

  await login(page);
  await page.goto('/reports?from=2026-01-05&to=2026-01-11&tab=detailed');
  const rows = page.locator('tr.entry-row');
  await expect(rows).toHaveCount(2);
  await expectNoPageOverflow(page);
  const wireframes = rows.filter({ hasText: 'Wireframes' });

  const client = wireframes.locator('td.detailed-client');
  await expect(client).toHaveText('Northwind Traders International Holdings Group');
  await expect(client).toHaveAttribute('title', 'Northwind Traders International Holdings Group');
  await expect(client).toHaveCSS('white-space', 'nowrap');
  await expect(client).toHaveCSS('text-overflow', 'ellipsis');
  const clientBox = await client.evaluate((cell) => ({
    width: cell.getBoundingClientRect().width,
    clipped: cell.scrollWidth > cell.clientWidth,
  }));
  expect(clientBox.width).toBeLessThanOrEqual(180.5);
  expect(clientBox.clipped, 'the long client is cut off').toBe(true);
  await expect(wireframes.locator('.project-label-name')).toHaveAttribute('title', 'Website Redesign Phase Two');

  // The chips sit side by side on one line.
  const chipTops = await wireframes.locator('td.detailed-tags .tag-chip').evaluateAll((chips) =>
    chips.map((chip) => chip.getBoundingClientRect().top));
  expect(chipTops).toHaveLength(3);
  expect(new Set(chipTops).size, 'the tags wrap onto a second line').toBe(1);

  // A short multi-word client stays whole on one line too.
  await expect(rows.filter({ hasText: 'Wiki' }).locator('td.detailed-client')).toHaveText('Acme Widget Co');
  for (const height of await rows.evaluateAll((elements) => elements.map((row) => row.getBoundingClientRect().height))) {
    expect(height, 'a detailed row wraps onto a second line').toBeLessThan(56);
  }
});
