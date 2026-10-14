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
