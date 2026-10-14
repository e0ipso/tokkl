import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

/** Clicks an export button and returns the CSV it downloads. */
async function exportCsv(page: Page, button: string): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Export' }).getByRole('button', { name: button }).click();
  return readFile(await (await download).path(), 'utf8');
}

test('detailed report pages and CSV exports reach every entry of a range longer than a year', async ({ page, data }) => {
  // 101 one-hour entries a week apart, from 2024-11-01 on: more than a page, over more than a year.
  const names: string[] = [];
  for (let i = 0; i < 101; i++) {
    const day = new Date(Date.UTC(2024, 10, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const description = `Entry ${String(i + 1).padStart(3, '0')}`;
    names.push(description);
    await data.createEntry({ description, start: `${day}T09:00:00Z`, stop: `${day}T10:00:00Z` });
  }
  await login(page);
  await page.goto('/reports?range=all_time&tab=detailed');
  const pager = page.getByRole('navigation', { name: 'Pages' });
  const descriptions = page.locator('td.detailed-description');
  await expect(pager).toContainText('1 to 100 of 101');
  await expect(descriptions).toHaveCount(100);
  const seen = await descriptions.allTextContents();
  await pager.getByRole('button', { name: 'Next' }).click();
  await expect(pager).toContainText('101 to 101 of 101');
  await expect(descriptions).toHaveCount(1);
  seen.push(...await descriptions.allTextContents());
  expect(seen.map((text) => text.trim()).sort()).toEqual(names);

  const detailed = await exportCsv(page, 'CSV (detailed)');
  expect(detailed.trim().split(/\r?\n/)).toHaveLength(102);
  expect(names.filter((name) => !detailed.includes(name))).toEqual([]);
  // Grouped by project, then description: one row per entry under "(none)".
  const summary = await exportCsv(page, 'CSV (summary)');
  expect(summary.trim().split(/\r?\n/).slice(1)).toEqual(names.map((name) => `(none),${name},1:00:00`));
});

test('only the summary tab fetches its grouping, and returning to it reuses the result until an edit', async ({ page, data }) => {
  await data.createEntry({ description: 'Before the edit', start: '2026-01-07T09:00:00Z', stop: '2026-01-07T10:00:00Z' });
  // grouping/sub_grouping of every POST /api/app/report, in order.
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/app/report') return;
    const body = request.postDataJSON() as { grouping: string; sub_grouping: string };
    fetched.push(`${body.grouping}/${body.sub_grouping}`);
  });
  await login(page);
  await page.goto('/reports?from=2026-01-05&to=2026-01-11');
  const tab = (name: string) => page.getByRole('tablist', { name: 'Report type' }).getByRole('tab', { name });
  const breakdown = page.getByRole('region', { name: 'Breakdown' });
  const detailedRow = page.locator('tr.entry-row');
  /** Opens the detailed tab and waits for its own entries request, which it sends on every visit. */
  const openDetailed = async () => {
    const entries = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/app/report/entries');
    await tab('Detailed').click();
    await entries;
    await expect(detailedRow).toHaveCount(1);
  };

  await expect(breakdown.getByText('Without project')).toBeVisible();
  expect(fetched).toEqual(['projects/time_entries']);
  await tab('Weekly').click();
  await expect(page.getByRole('group', { name: 'Rows' })).toBeVisible();
  await expect.poll(() => fetched).toEqual(['projects/time_entries', 'projects/projects']);
  await openDetailed();
  await tab('Summary').click();
  await expect(breakdown.getByText('Without project')).toBeVisible();
  // The detailed tab's entries request comes after any refetch the summary would have sent.
  await openDetailed();
  expect(fetched).toEqual(['projects/time_entries', 'projects/projects']);

  await detailedRow.click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await editor.getByLabel('Description').fill('After the edit');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(detailedRow).toContainText('After the edit');
  await tab('Summary').click();
  await breakdown.getByRole('button', { name: /breakdown for Without project/ }).click();
  await expect(breakdown.getByText('After the edit')).toBeVisible();
  await expect(breakdown.getByText('Before the edit')).toHaveCount(0);
  expect(fetched.at(-1)).toBe('projects/time_entries');
});
