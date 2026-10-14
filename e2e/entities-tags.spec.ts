import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi, countRequests, entryRow, yesterday } from './entity-tests-helpers.ts';

/** Tag names per entry description, as the API stores them. */
async function savedTags(api: EntityApi): Promise<Record<string, string[]>> {
  return Object.fromEntries((await api.entries()).map((entry) => [entry.description, [...entry.tags].sort()]));
}

/** Tag chips per entry row in the timer list. */
async function historyChips(page: Page, descriptions: string[]): Promise<Record<string, string[]>> {
  await page.getByRole('link', { name: 'Timer' }).click();
  await expect(entryRow(page, descriptions[0]!)).toBeVisible();
  const chips: Record<string, string[]> = {};
  for (const description of descriptions) {
    chips[description] = (await entryRow(page, description).locator('.tag-chip').allTextContents()).sort();
  }
  return chips;
}

/** Tag chips per row of the detailed report. */
async function reportChips(page: Page, descriptions: string[]): Promise<Record<string, string[]>> {
  await page.goto('/reports?range=all_time&tab=detailed');
  const rows = page.locator('tr.entry-row');
  await expect(rows).toHaveCount(descriptions.length);
  const chips: Record<string, string[]> = {};
  for (const description of descriptions) {
    chips[description] = (await rows.filter({ hasText: description }).locator('.tag-chip').allTextContents()).sort();
  }
  return chips;
}

/** Tags the picker offers on an entry row, with whether each is checked; closes the picker. */
async function pickerTags(page: Page, description: string): Promise<Array<[string, boolean]>> {
  await page.getByRole('link', { name: 'Timer' }).click();
  await entryRow(page, description).locator('.entry-tags').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create tags…') });
  const items = picker.locator('label.picker-check');
  await expect(items.first()).toBeVisible();
  const tags: Array<[string, boolean]> = [];
  for (const item of await items.all()) tags.push([(await item.textContent())!.trim(), await item.getByRole('checkbox').isChecked()]);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  return tags;
}

test('renaming an attached tag with Enter or blur saves once and reaches entries, history, picker and reports; Escape cancels', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const tag = await api.createTag('review');
  await api.createEntry({ description: 'Code walkthrough', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z`, tags: ['review', 'ops'] });
  await api.createEntry({ description: 'Design crit', start: `${day}T10:00:00Z`, stop: `${day}T10:30:00Z`, tags: ['review'] });
  const descriptions = ['Code walkthrough', 'Design crit'];
  const renames = countRequests(page, 'PUT', new RegExp(`/tags/${tag.id}$`));

  await page.getByRole('link', { name: 'Tags' }).click();
  await page.getByRole('button', { name: 'Rename review' }).click();
  let input = page.getByRole('textbox', { name: 'New name for review' });
  await input.fill('code review');
  await input.press('Enter');
  await expect(page.getByText('Renamed to code review')).toBeVisible();
  await expect(input).toBeHidden();
  expect(renames()).toBe(1);
  expect(await savedTags(api)).toEqual({ 'Code walkthrough': ['code review', 'ops'], 'Design crit': ['code review'] });
  expect(await historyChips(page, descriptions)).toEqual({ 'Code walkthrough': ['code review', 'ops'], 'Design crit': ['code review'] });
  expect(await pickerTags(page, 'Design crit')).toEqual([['code review', true], ['ops', false]]);
  expect(await reportChips(page, descriptions)).toEqual({ 'Code walkthrough': ['code review', 'ops'], 'Design crit': ['code review'] });

  // Clicking away saves the draft, once.
  await page.getByRole('link', { name: 'Tags' }).click();
  await page.getByRole('button', { name: 'Rename code review' }).click();
  input = page.getByRole('textbox', { name: 'New name for code review' });
  await input.fill('peer review');
  await page.getByRole('heading', { name: 'Tags' }).click();
  await expect(page.getByText('Renamed to peer review')).toBeVisible();
  expect(renames()).toBe(2);
  expect(await savedTags(api)).toEqual({ 'Code walkthrough': ['ops', 'peer review'], 'Design crit': ['peer review'] });

  // Escape drops the draft without a request.
  await page.getByRole('button', { name: 'Rename peer review' }).click();
  input = page.getByRole('textbox', { name: 'New name for peer review' });
  await input.fill('discarded');
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(page.locator('.tag-chip', { hasText: 'peer review' })).toBeVisible();
  await expect(page.getByText('discarded')).toHaveCount(0);
  expect(renames()).toBe(2);
  expect((await api.tags()).map((t) => t.name).sort()).toEqual(['ops', 'peer review']);
  expect(await savedTags(api)).toEqual({ 'Code walkthrough': ['ops', 'peer review'], 'Design crit': ['peer review'] });
});

test('deleting an attached tag takes it off its entries and keeps the entries', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const seeded = [
    await api.createEntry({ description: 'Code walkthrough', start: `${day}T08:00:00Z`, stop: `${day}T09:00:00Z`, tags: ['review', 'ops'], billable: true }),
    await api.createEntry({ description: 'Design crit', start: `${day}T10:00:00Z`, stop: `${day}T10:30:00Z`, tags: ['review'] }),
    await api.createEntry({ description: 'Untagged', start: `${day}T11:00:00Z`, stop: `${day}T11:10:00Z` }),
  ];
  const descriptions = seeded.map((entry) => entry.description);
  const before = await api.entries();

  await page.getByRole('link', { name: 'Tags' }).click();
  await page.getByRole('button', { name: 'Delete review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete review?' });
  await dialog.getByRole('button', { name: 'Delete tag' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deleted review')).toBeVisible();

  expect((await api.tags()).map((t) => t.name)).toEqual(['ops']);
  const after = await api.entries();
  // Same entries, same fields, minus the tag.
  const withoutTags = (entries: typeof before) => entries
    .map(({ id, description, start, stop, duration, billable, project_id }) => ({ id, description, start, stop, duration, billable, project_id }))
    .sort((a, b) => a.id - b.id);
  expect(withoutTags(after)).toEqual(withoutTags(before));
  expect(await savedTags(api)).toEqual({ 'Code walkthrough': ['ops'], 'Design crit': [], Untagged: [] });
  expect(await historyChips(page, descriptions)).toEqual({ 'Code walkthrough': ['ops'], 'Design crit': [], Untagged: [] });
  expect(await pickerTags(page, 'Design crit')).toEqual([['ops', false]]);
  expect(await reportChips(page, descriptions)).toEqual({ 'Code walkthrough': ['ops'], 'Design crit': [], Untagged: [] });
});
