import type { Page } from '@playwright/test';
import { cellTexts, expect, hms, iso, test } from './report-tests-helpers.ts';
import { login } from './helpers.ts';

// "Today" for these scenarios: Thursday 1 January 2026 in Europe/Madrid.
const NOW = new Date('2026-01-01T10:00:00Z');

const totalTime = (page: Page) => page.locator('.report-totals div', { hasText: 'Total time' }).locator('dd');
const rangeButton = (page: Page) => page.locator('.range-button');

/** Waits for the URL to carry exactly this range, then for the report to show it. */
async function expectRange(page: Page, from: string, to: string, label: string, total: string | null) {
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams;
    return `${params.get('from')}..${params.get('to')}`;
  }).toBe(`${from}..${to}`);
  await expect(rangeButton(page)).toContainText(label);
  if (total === null) await expect(page.getByText('No time tracked in this range')).toBeVisible();
  else await expect(totalTime(page)).toHaveText(total);
}

async function choosePreset(page: Page, name: string) {
  await rangeButton(page).click();
  await page.getByRole('listbox', { name: 'Date range' }).getByRole('option', { name }).click();
}

async function chooseCustom(page: Page, from: string, to: string) {
  await rangeButton(page).click();
  await page.getByLabel('From', { exact: true }).fill(from);
  await page.getByLabel('To', { exact: true }).fill(to);
  await page.getByRole('button', { name: 'Apply' }).click();
}

test('preset and custom ranges step by exact dates across month and year boundaries and follow the first weekday', async ({ page, api }) => {
  // One entry on each side of the two week boundaries around New Year.
  await api.entry({ description: 'Sunday 28 Dec', start: '2025-12-28T10:00:00Z', stop: '2025-12-28T11:00:00Z' });
  await api.entry({ description: 'Monday 29 Dec', start: '2025-12-29T10:00:00Z', stop: '2025-12-29T12:00:00Z' });
  await api.entry({ description: 'Sunday 4 Jan', start: '2026-01-04T10:00:00Z', stop: '2026-01-04T13:00:00Z' });
  await api.entry({ description: 'Monday 5 Jan', start: '2026-01-05T10:00:00Z', stop: '2026-01-05T14:00:00Z' });
  await api.setWeekStart(1);
  await page.clock.setFixedTime(NOW);
  await login(page);

  // Weeks start on Monday: this week runs from Monday 29 December to Sunday 4 January.
  await page.goto('/reports');
  await expect(rangeButton(page)).toContainText('This week');
  await expect(rangeButton(page)).toContainText('29 Dec 2025 to 4 Jan 2026');
  await expect(totalTime(page)).toHaveText('5:00:00');
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expectRange(page, '2025-12-22', '2025-12-28', '22 Dec to 28 Dec 2025', '1:00:00');
  await expect(rangeButton(page)).toContainText('Last week');
  await page.keyboard.press('ArrowRight');
  await expectRange(page, '2025-12-29', '2026-01-04', '29 Dec 2025 to 4 Jan 2026', '5:00:00');
  await page.keyboard.press('ArrowRight');
  await expectRange(page, '2026-01-05', '2026-01-11', '5 Jan to 11 Jan', '4:00:00');

  // Weeks start on Sunday: this week runs from Sunday 28 December to Saturday 3 January.
  await api.setWeekStart(0);
  await page.goto('/reports?range=this_week');
  await expect(rangeButton(page)).toContainText('28 Dec 2025 to 3 Jan 2026');
  await expect(totalTime(page)).toHaveText('3:00:00');
  await page.keyboard.press('ArrowLeft');
  await expectRange(page, '2025-12-21', '2025-12-27', '21 Dec to 27 Dec 2025', null);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectRange(page, '2026-01-04', '2026-01-10', '4 Jan to 10 Jan', '7:00:00');

  // Whole months move by calendar months, whatever their length.
  await choosePreset(page, 'This month');
  await expect(rangeButton(page)).toContainText('1 Jan to 31 Jan');
  await expect(totalTime(page)).toHaveText('7:00:00');
  await page.keyboard.press('ArrowLeft');
  await expectRange(page, '2025-12-01', '2025-12-31', '1 Dec to 31 Dec 2025', '3:00:00');
  await expect(rangeButton(page)).toContainText('Last month');
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expectRange(page, '2025-11-01', '2025-11-30', '1 Nov to 30 Nov 2025', null);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expectRange(page, '2026-02-01', '2026-02-28', '1 Feb to 28 Feb', null);

  // Years step back to the previous calendar year.
  await choosePreset(page, 'This year');
  await expect(rangeButton(page)).toContainText('1 Jan to 31 Dec');
  await page.keyboard.press('ArrowLeft');
  await expectRange(page, '2025-01-01', '2025-12-31', '1 Jan to 31 Dec 2025', '3:00:00');
  await expect(rangeButton(page)).toContainText('Last year');

  // A custom range of days moves by its own length, across the new year.
  await chooseCustom(page, '2025-12-27', '2025-12-29');
  await expectRange(page, '2025-12-27', '2025-12-29', '27 Dec to 29 Dec 2025', '3:00:00');
  await page.getByRole('button', { name: 'Next period' }).click();
  await expectRange(page, '2025-12-30', '2026-01-01', '30 Dec 2025 to 1 Jan 2026', null);
  await page.keyboard.press('ArrowRight');
  await expectRange(page, '2026-01-02', '2026-01-04', '2 Jan to 4 Jan', '3:00:00');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await expectRange(page, '2025-12-24', '2025-12-26', '24 Dec to 26 Dec 2025', null);

  // A custom range of whole months moves by that many calendar months.
  await chooseCustom(page, '2025-11-01', '2025-12-31');
  await expectRange(page, '2025-11-01', '2025-12-31', '1 Nov to 31 Dec 2025', '3:00:00');
  await page.keyboard.press('ArrowRight');
  await expectRange(page, '2026-01-01', '2026-02-28', '1 Jan to 28 Feb', '7:00:00');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expectRange(page, '2025-09-01', '2025-10-31', '1 Sep to 31 Oct 2025', null);
});

test('a saved report URL restores every control and the matching results', async ({ page, api }) => {
  const acme = await api.client('ACME');
  const alpha = await api.project({ name: 'Alpha', client_id: acme });
  const beta = await api.project({ name: 'Beta', client_id: acme });
  const gamma = await api.project({ name: 'Gamma' });

  // 103 matches lasting 1 to 103 minutes; odd ones are tagged "draft".
  for (let i = 1; i <= 103; i++) {
    const start = Date.UTC(2025, 10, 1 + (i % 61), 9);
    await api.entry({
      description: `match ${String(i).padStart(3, '0')}`, project_id: alpha, billable: true,
      start: iso(start), stop: iso(start + i * 60_000), tags: i % 2 ? ['draft'] : [],
    });
  }
  // Each of these fails exactly one filter, and lasts longer than any match.
  const long = { start: '2025-11-20T12:00:00Z', stop: '2025-11-20T16:00:00Z' };
  await api.entry({ description: 'match beta', project_id: beta, billable: true, ...long });
  await api.entry({ description: 'match gamma', project_id: gamma, billable: true, ...long });
  await api.entry({ description: 'match paid', project_id: alpha, billable: true, tags: ['paid'], ...long });
  await api.entry({ description: 'match unbilled', project_id: alpha, billable: false, ...long });
  await api.entry({ description: 'other work', project_id: alpha, billable: true, ...long });
  await api.entry({ description: 'match late', project_id: alpha, billable: true, start: '2026-01-02T12:00:00Z', stop: '2026-01-02T16:00:00Z' });
  const paid = await api.tagId('paid');

  // In the order the app writes its parameters, so an unchanged state keeps the URL as is.
  const search = `?from=2025-11-01&to=2025-12-31&tab=detailed&group=clients&sub=tags&projects=not.${beta}&clients=${acme}`
    + `&tags=not.${paid}&billable=billable&q=match&sort=duration&dir=asc&page=2&rows=clients`;
  await page.clock.setFixedTime(NOW);
  await login(page);
  await page.goto(`/reports${search}`);

  const pager = page.getByRole('navigation', { name: 'Pages' });
  await expect(pager).toContainText('101 to 103 of 103');
  const rows = page.locator('tr.entry-row');
  expect((await cellTexts(rows)).map((cells) => [cells[1], cells[6]])).toEqual([
    ['match 101', '1:41:00'], ['match 102', '1:42:00'], ['match 103', '1:43:00'],
  ]);
  expect(new URL(page.url()).search).toBe(search);
  await expect(rangeButton(page)).toContainText('1 Nov to 31 Dec 2025');
  const tabs = page.getByRole('tablist', { name: 'Report type' });
  await expect(tabs.getByRole('tab', { name: 'Detailed' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('columnheader', { name: 'Duration' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'none');

  const filters = page.getByRole('group', { name: 'Filters' });
  await expect(filters.getByRole('button', { name: /Project.*not Beta/ })).toBeVisible();
  await expect(filters.getByRole('button', { name: /Client.*ACME/ })).toBeVisible();
  await expect(filters.getByRole('combobox', { name: 'Billable' })).toHaveValue('billable');
  await expect(filters.getByLabel('Filter by description')).toHaveValue('match');
  await filters.getByRole('button', { name: /Tag.*not paid/ }).click();
  await expect(page.getByRole('group', { name: 'Tag filter mode' }).getByRole('button', { name: 'Is not' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'paid' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'draft' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: 'paid' })).toBeHidden();

  // 1 + 2 + ... + 103 minutes; odd minutes are tagged "draft".
  const all = hms(103 * 104 / 2 * 60);
  await tabs.getByRole('tab', { name: 'Weekly' }).click();
  await expect(page.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-pressed', 'true');
  const weeklyRows = await cellTexts(page.locator('.weekly-table tbody tr'));
  expect(weeklyRows.map((cells) => [cells[0], cells.at(-1)])).toEqual([['ACME', all]]);

  await tabs.getByRole('tab', { name: 'Summary' }).click();
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  await expect(breakdown.getByLabel('Group by')).toHaveValue('clients');
  await expect(breakdown.getByLabel('then by')).toHaveValue('tags');
  await expect(page.locator('.report-totals div', { hasText: 'Entries' }).locator('dd')).toHaveText('103');
  await expect(totalTime(page)).toHaveText(all);
  await breakdown.getByRole('button', { name: 'Show tag breakdown for ACME' }).click();
  expect((await cellTexts(breakdown.locator('tbody tr'))).map((cells) => [cells[0], cells[1]])).toEqual([
    ['ACME', all],
    ['draft', hms(52 * 52 * 60)],
    ['Without tags', hms(51 * 52 * 60)],
  ]);
  // The page number survives tab changes, so returning to the detailed tab shows the same rows.
  await tabs.getByRole('tab', { name: 'Detailed' }).click();
  await expect(pager).toContainText('101 to 103 of 103');
});

test('"Is not" chosen before any client or tag option stays negated and excludes the option picked next', async ({ page, api }) => {
  const alpha = await api.project({ name: 'Alpha', client_id: await api.client('ACME') });
  const globex = await api.client('Globex');
  const beta = await api.project({ name: 'Beta', client_id: globex });
  await api.entry({ description: 'Kickoff', project_id: alpha, tags: ['scope'], start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z' });
  await api.entry({ description: 'Research', project_id: beta, tags: ['invoiced'], start: '2026-01-06T09:00:00Z', stop: '2026-01-06T11:00:00Z' });
  const invoiced = await api.tagId('invoiced');
  await login(page);

  // The project case runs on the phone in e2e/mobile-reports.spec.ts.
  for (const { label, param, option, id } of [
    { label: 'Client', param: 'clients', option: 'Globex', id: globex },
    { label: 'Tag', param: 'tags', option: 'invoiced', id: invoiced },
  ]) {
    await page.goto('/reports?from=2026-01-05&to=2026-01-11');
    await expect(totalTime(page)).toHaveText('3:00:00');
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: label }).click();
    const popover = page.getByRole('dialog').filter({ has: page.getByLabel(`Find ${label.toLowerCase()}`) });
    const mode = popover.getByRole('group', { name: `${label} filter mode` });
    const isNot = mode.getByRole('button', { name: 'Is not' });
    const filter = () => new URL(page.url()).searchParams.get(param);

    // An empty "Is not" survives in the URL and filters nothing; "Is" drops it again.
    await isNot.click();
    await expect(isNot).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(filter).toBe('not.');
    await expect(totalTime(page)).toHaveText('3:00:00');
    await mode.getByRole('button', { name: 'Is', exact: true }).click();
    await expect.poll(filter).toBeNull();
    await isNot.click();
    await expect.poll(filter).toBe('not.');

    await popover.getByRole('checkbox', { name: option }).check();
    await expect(isNot).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(filter).toBe(`not.${id}`);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(totalTime(page)).toHaveText('1:00:00');
  }
});

// TT-0070: the reports description search is the shared SearchBox; typing still filters the
// report through the URL, and clearing it brings every entry back.
test('typing in the description search filters the report and the URL, and clearing it restores both', async ({ page, api }) => {
  await api.entry({ description: 'Design review', start: '2025-12-29T10:00:00Z', stop: '2025-12-29T11:00:00Z' });
  await api.entry({ description: 'Standup', start: '2025-12-30T10:00:00Z', stop: '2025-12-30T12:00:00Z' });
  await login(page);
  await page.goto('/reports?from=2025-12-29&to=2026-01-04');
  await expect(totalTime(page)).toHaveText('3:00:00');

  const search = page.getByRole('group', { name: 'Filters' }).getByLabel('Filter by description');
  await search.fill('review');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('review');
  await expect(totalTime(page)).toHaveText('1:00:00');

  await search.fill('');
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(totalTime(page)).toHaveText('3:00:00');
});
