import type { Locator, Page } from '@playwright/test';
import { cellTexts, expect, expectWholeAmounts, hms, iso, money, seedWideAmounts, test, type ReportApi } from './report-tests-helpers.ts';
import { login } from './helpers.ts';

const WEEK = '/reports?from=2026-01-05&to=2026-01-11';

const total = (page: Page, label: string) => page.locator('.report-totals div', { hasText: label }).locator('dd');
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Report type' }).getByRole('tab', { name });

async function chartRows(page: Page): Promise<string[][]> {
  const details = page.locator('details.chart-data');
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await details.getByText('Show chart data as a table').click();
  }
  return cellTexts(details.locator('tbody tr'));
}

/**
 * Monday 5 to Sunday 11 January 2026, Europe/Madrid. Alpha bills 100 USD an hour, Beta falls back
 * to the workspace's 50 EUR, and non-billable time has no amount.
 */
async function seedMixedWeek(api: ReportApi) {
  await api.setWorkspace({ default_hourly_rate: 50, default_currency: 'EUR', rounding: 0, rounding_minutes: 0 });
  await api.setWeekStart(1);
  const acme = await api.client('ACME');
  const alpha = await api.project({ name: 'Alpha', client_id: acme, billable: true, rate: 100, currency: 'USD' });
  const beta = await api.project({ name: 'Beta', billable: true });
  await api.entry({ description: 'Design', project_id: alpha, billable: true, start: '2026-01-05T09:00:00Z', stop: '2026-01-05T11:00:00Z' });
  await api.entry({ description: 'Support', project_id: beta, billable: true, start: '2026-01-06T09:00:00Z', stop: '2026-01-06T10:00:00Z' });
  await api.entry({ description: 'Build', project_id: alpha, billable: true, start: '2026-01-07T09:00:00Z', stop: '2026-01-07T10:30:00Z' });
  await api.entry({ description: 'Internal', project_id: beta, billable: false, start: '2026-01-08T09:00:00Z', stop: '2026-01-08T09:30:00Z' });
  await api.entry({ description: 'Email', start: '2026-01-09T09:00:00Z', stop: '2026-01-09T09:45:00Z' });
  return { beta };
}

test('summary totals, groups, chart and weekly grid reconcile with known data and keep currencies apart', async ({ page, api }) => {
  const { beta } = await seedMixedWeek(api);
  await login(page);
  await page.goto(WEEK);

  await expect(total(page, 'Total time')).toHaveText('5:45:00');
  await expect(total(page, 'Billable time')).toHaveText('4:30:00 78.3%');
  await expect(total(page, 'Entries')).toHaveText('5');
  // 3.5 h at 100 USD and 1 h at 50 EUR, shown side by side and never added up.
  await expect(total(page, 'Amount').locator('.report-amount')).toHaveText([
    await money(page, 35_000, 'USD'), await money(page, 5_000, 'EUR'),
  ]);
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  await expect(breakdown.getByText('Amounts per row are hidden because this report mixes currencies.')).toBeVisible();
  await expect(breakdown.getByRole('columnheader', { name: 'Amount' })).toHaveCount(0);
  await expect.poll(() => cellTexts(breakdown.locator('tbody tr'))).toEqual([
    ['Alpha', '3:30:00', '60.9%'],
    ['Beta', '1:30:00', '26.1%'],
    ['Without project', '0:45:00', '13.0%'],
  ]);

  await expect(page.getByRole('img', { name: /7 days, 5:45:00 in total/ })).toBeVisible();
  expect(await chartRows(page)).toEqual([
    ['Mon, 5 Jan 2026', '2:00:00', '2:00:00', '0:00:00'],
    ['Tue, 6 Jan 2026', '1:00:00', '1:00:00', '0:00:00'],
    ['Wed, 7 Jan 2026', '1:30:00', '1:30:00', '0:00:00'],
    ['Thu, 8 Jan 2026', '0:30:00', '0:00:00', '0:30:00'],
    ['Fri, 9 Jan 2026', '0:45:00', '0:00:00', '0:45:00'],
    ['Sat, 10 Jan 2026', '0:00:00', '0:00:00', '0:00:00'],
    ['Sun, 11 Jan 2026', '0:00:00', '0:00:00', '0:00:00'],
  ]);

  await tab(page, 'Weekly').click();
  const head = page.locator('.weekly-table thead tr');
  await expect(head).toHaveText(/Mon5 Jan.*Sun11 Jan/);
  const weekly = () => cellTexts(page.locator('.weekly-table tbody tr, .weekly-table tfoot tr'));
  await expect.poll(weekly).toEqual([
    ['Alpha', '2:00:00', '-', '1:30:00', '-', '-', '-', '-', '3:30:00'],
    ['Beta', '-', '1:00:00', '-', '0:30:00', '-', '-', '-', '1:30:00'],
    ['Without project', '-', '-', '-', '-', '0:45:00', '-', '-', '0:45:00'],
    ['Total', '2:00:00', '1:00:00', '1:30:00', '0:30:00', '0:45:00', '-', '-', '5:45:00'],
  ]);
  await page.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'Clients' }).click();
  await expect.poll(weekly).toEqual([
    ['ACME', '2:00:00', '-', '1:30:00', '-', '-', '-', '-', '3:30:00'],
    ['Without client', '-', '1:00:00', '-', '0:30:00', '0:45:00', '-', '-', '2:15:00'],
    ['Total', '2:00:00', '1:00:00', '1:30:00', '0:30:00', '0:45:00', '-', '-', '5:45:00'],
  ]);

  // With one currency left, each row shows its amount.
  await page.goto(`${WEEK}&projects=${beta}`);
  const euros = await money(page, 5_000, 'EUR');
  await expect(total(page, 'Amount')).toHaveText(euros);
  await expect(breakdown.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
  await expect.poll(() => cellTexts(breakdown.locator('tbody tr'))).toEqual([['Beta', '1:30:00', '100.0%', euros]]);
});

// 768px is a tablet in portrait; 900px and 1280px are narrow and common desktop windows.
test('each Amount figure stays on one line inside its tile from a tablet to a desktop window', async ({ page, api }) => {
  const reports = await seedWideAmounts(api);
  await login(page);
  for (const width of [1280, 900, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const report of reports) await expectWholeAmounts(page, report);
  }
});

// Non-billable bars are striped as well as coloured, the legend is read out, and the
// chart takes its size from the --chart-* properties. The column the arrows reach gets a
// band and an axis strip.
test('the summary chart stripes non-billable bars, reads out its legend and sizes itself from CSS', async ({ page, api }) => {
  await seedMixedWeek(api);
  await login(page);
  // Two --chart-* overrides in place before the chart mounts, as an edit to reports.css would be.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html .series-chart { --chart-height: 300px; --chart-max-bar: 10px; }';
      document.head.append(style);
    });
  });
  await page.goto(WEEK);

  const chart = page.getByRole('img', { name: /7 days, 5:45:00 in total/ });
  await expect(chart).toHaveAttribute('height', '300');
  const billable = chart.locator('path.mark-billable');
  const other = chart.locator('path.mark-other');
  // Monday to Wednesday are billable; Thursday and Friday are not.
  await expect(billable).toHaveCount(3);
  await expect(other).toHaveCount(2);
  expect((await billable.first().boundingBox())?.width).toBeCloseTo(10, 1);

  const paint = (path: Locator) => path.evaluate((element) => {
    const fill = getComputedStyle(element).fill;
    const id = /^url\("?#(.+?)"?\)$/.exec(fill)?.[1];
    const target = id ? document.getElementById(id) : null;
    return {
      pattern: target?.tagName ?? null,
      stripes: target?.querySelectorAll('.chart-stripes-line').length ?? 0,
      solid: fill.startsWith('rgb'),
    };
  });
  for (const index of [0, 1]) expect(await paint(other.nth(index))).toEqual({ pattern: 'pattern', stripes: 1, solid: false });
  expect(await paint(billable.first())).toEqual({ pattern: null, stripes: 0, solid: true });

  const legend = page.locator('.chart-legend');
  await expect(legend).toHaveText('BillableNon-billable');
  expect(await legend.evaluate((element) => element.closest('[aria-hidden="true"]') === null)).toBe(true);
  expect(await paint(legend.locator('.mark-other'))).toEqual({ pattern: 'pattern', stripes: 1, solid: false });

  // Home makes Monday, which has only billable time, the active column.
  await chart.focus();
  await page.keyboard.press('Home');
  const active = chart.locator('g.is-active');
  await expect(active.locator('rect.chart-band')).toHaveCount(1);
  await expect(active.locator('rect.chart-band-strip')).toHaveAttribute('width', '10');
  await expect(active.locator('path.mark-billable')).toHaveCount(1);
  await expect(active.locator('path.mark-other')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Mon, 5 Jan 2026' })).toContainText('Billable 2:00:00');
});

// The chart is an SVG element marked data-own-arrows, so its arrow keys move the active
// column and never reach the page's range shortcut. Once focus leaves the chart, the shortcut
// moves the range again.
test('arrow keys on the summary chart move its column and leave the report range alone', async ({ page, api }) => {
  await seedMixedWeek(api);
  await login(page);
  await page.goto(WEEK);

  const chart = page.getByRole('img', { name: /7 days, 5:45:00 in total/ });
  const status = page.getByRole('status').filter({ has: page.locator('.chart-tooltip-label') });
  await chart.focus();
  // With no active column, ArrowLeft starts from the last one: Sunday, Saturday, then Friday.
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('Fri, 9 Jan 2026');
  await expect(status).toContainText('Non-billable 0:45:00');
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('Sat, 10 Jan 2026');
  await expect(chart).toBeFocused();
  await expect(chart.locator('g.is-active')).toHaveCount(1);
  expect(new URL(page.url()).search).toBe('?from=2026-01-05&to=2026-01-11');

  await chart.blur();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/\?from=2025-12-29&to=2026-01-04$/);
});

test('detailed rows sort globally and page across a range longer than a year', async ({ page, api }) => {
  // 105 entries four days apart from 1 January 2025. Durations and descriptions are permutations
  // unrelated to the dates, so a sort that only covered one page would show. Durations are distinct
  // multiples of the default 5-minute time resolution, so the server stores them unchanged.
  const entries = Array.from({ length: 105 }, (_, i) => ({
    description: `Task ${String((i * 58) % 105).padStart(3, '0')}`,
    start: Date.UTC(2025, 0, 1 + i * 4, 9),
    minutes: (((i * 37) % 105) + 1) * 5,
  }));
  for (const entry of entries) {
    await api.entry({ description: entry.description, start: iso(entry.start), stop: iso(entry.start + entry.minutes * 60_000) });
  }
  await login(page);
  const pager = page.getByRole('navigation', { name: 'Pages' });
  const rows = page.locator('tr.entry-row');

  /** Descriptions and durations of both pages, in display order. */
  const readPages = async () => {
    await expect(pager).toContainText('1 to 100 of 105');
    const seen = await cellTexts(rows);
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText('101 to 105 of 105');
    seen.push(...await cellTexts(rows));
    return seen.map((cells) => [cells[1], cells[6]]);
  };
  const expected = (compare: (a: typeof entries[number], b: typeof entries[number]) => number) =>
    [...entries].sort(compare).map((entry) => [entry.description, hms(entry.minutes * 60)]);

  await page.goto('/reports?from=2025-01-01&to=2026-02-28&tab=detailed');
  expect(await readPages()).toEqual(expected((a, b) => b.start - a.start));
  const header = (name: string) => page.getByRole('columnheader', { name }).getByRole('button');
  await header('Date').click();
  expect(await readPages()).toEqual(expected((a, b) => a.start - b.start));
  await header('Duration').click();
  expect(await readPages()).toEqual(expected((a, b) => b.minutes - a.minutes));
  await header('Duration').click();
  expect(await readPages()).toEqual(expected((a, b) => a.minutes - b.minutes));
  await header('Description').click();
  expect(await readPages()).toEqual(expected((a, b) => a.description.localeCompare(b.description)));
  await header('Description').click();
  expect(await readPages()).toEqual(expected((a, b) => b.description.localeCompare(a.description)));
});

test('saving a detailed row persists the change and refreshes the summary, chart and weekly views', async ({ page, api }) => {
  await api.setWorkspace({ rounding: 0, rounding_minutes: 0 });
  await api.setWeekStart(1);
  await api.entry({ description: 'Keep', start: '2026-01-05T09:00:00Z', stop: '2026-01-05T10:00:00Z' });
  const id = await api.entry({ description: 'Change me', start: '2026-01-06T09:00:00Z', stop: '2026-01-06T10:00:00Z' });
  await login(page);
  await page.goto(WEEK);
  await expect(total(page, 'Total time')).toHaveText('2:00:00');
  await tab(page, 'Weekly').click();
  await expect(page.locator('.weekly-table tfoot td').last()).toHaveText('2:00:00');

  await tab(page, 'Detailed').click();
  const row = page.locator('tr.entry-row', { hasText: 'Change me' });
  await row.click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  // 10:00 to 11:00 in Madrid becomes 10:00 to 12:30.
  await expect(editor.getByLabel('End', { exact: true })).toHaveValue('11:00');
  await editor.getByLabel('End', { exact: true }).fill('12:30');
  await editor.getByLabel('End', { exact: true }).blur();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(row.locator('td').nth(6)).toHaveText('2:30:00');

  const check = async () => {
    await tab(page, 'Weekly').click();
    await expect.poll(() => cellTexts(page.locator('.weekly-table tfoot tr'))).toEqual([
      ['Total', '1:00:00', '2:30:00', '-', '-', '-', '-', '-', '3:30:00'],
    ]);
    await tab(page, 'Summary').click();
    await expect(total(page, 'Total time')).toHaveText('3:30:00');
    expect((await chartRows(page)).slice(0, 2).map((cells) => cells[1])).toEqual(['1:00:00', '2:30:00']);
    await tab(page, 'Detailed').click();
    await expect(page.locator('tr.entry-row', { hasText: 'Change me' }).locator('td').nth(6)).toHaveText('2:30:00');
  };
  await check();
  expect(await api.getEntry(id)).toMatchObject({ start: '2026-01-06T09:00:00+00:00', stop: '2026-01-06T11:30:00+00:00', duration: 9000 });
  await page.reload();
  await check();
});
