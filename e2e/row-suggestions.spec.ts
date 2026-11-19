import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { daysAgo } from './groups-refresh-tests-helpers.ts';
import { login } from './helpers.ts';
import { SUGGESTION, TimerApi, metadataOf, seedSuggestion } from './timer-tests-helpers.ts';

// An entry list row's description suggests recent entries as the timer bar does (issue #93). A pick writes every
// field in one bulk PATCH, billable last because a project change resets it on the server.

interface EntryWrite {
  method: string;
  path: string;
  body: unknown;
}

/** Every write to time entries the page sends from now on. */
function recordEntryWrites(page: Page): EntryWrite[] {
  const writes: EntryWrite[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && /\/time_entries(\/|$)/.test(path))
      writes.push({ method: request.method(), path, body: request.postDataJSON() });
  });
  return writes;
}

/** The ids a bulk PATCH path names, sorted. */
function bulkIds(write: EntryWrite): number[] {
  const match = /^\/api\/v9\/workspaces\/\d+\/time_entries\/([\d,]+)$/.exec(write.path);
  expect(match, `${write.method} ${write.path} is a bulk entry PATCH`).not.toBeNull();
  return match![1]!
    .split(',')
    .map(Number)
    .sort((a, b) => a - b);
}

const SUGGESTION_PATHS = ['/description', '/project_id', '/task_id', '/tags', '/billable'];

function paths(write: EntryWrite): string[] {
  return (write.body as Array<{ path: string }>).map(operation => operation.path);
}

/** A blur that wrongly resends the description would go out at once; a quiet second shows none did. */
async function expectNoFurtherWrites(page: Page, writes: EntryWrite[], count: number): Promise<void> {
  await page.waitForTimeout(1_000);
  expect(writes).toHaveLength(count);
}

test('a row pick sends one PATCH with every field and nothing on blur, and Enter with no highlight commits the typed text', async ({
  page,
}) => {
  await login(page);
  const api = await TimerApi.open(page);
  const picked = await seedSuggestion(api, daysAgo(3));
  const target = await api.createEntry({
    description: 'Target entry',
    start: `${daysAgo(1)}T09:00:00Z`,
    stop: `${daysAgo(1)}T10:00:00Z`,
  });
  await page.reload();

  // No entry today, so the newest day holds only the target. Its locator survives the description change.
  const row = page.locator('.day-group').first().locator('.entry-line');
  await expect(row).toHaveCount(1);
  const description = row.getByRole('combobox', { name: 'Description' });
  const suggestions = row.getByRole('listbox', { name: 'Suggestions' });
  await expect(description).toHaveValue('Target entry');
  const writes = recordEntryWrites(page);

  await description.click();
  await description.fill('Sugg');
  const option = suggestions.getByRole('option', { name: SUGGESTION.description });
  await expect(option).toBeVisible();
  await description.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await description.press('Enter');
  await expect(suggestions).toBeHidden();
  await expect(description).toHaveValue(SUGGESTION.description);
  await expect(row.locator('.project-label')).toContainText(SUGGESTION.label);
  await expect(row.locator('.entry-tags')).toContainText(SUGGESTION.tag);
  await expect(row.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');

  await description.press('Tab');
  await expect(description).not.toBeFocused();
  await expectNoFurtherWrites(page, writes, 1);
  const [pick] = writes;
  expect(pick!.method).toBe('PATCH');
  expect(bulkIds(pick!)).toEqual([target.id]);
  expect(paths(pick!)).toEqual(SUGGESTION_PATHS);
  expect(pick!.body).toEqual([
    { op: 'replace', path: '/description', value: picked.description },
    { op: 'replace', path: '/project_id', value: picked.project_id },
    { op: 'replace', path: '/task_id', value: picked.task_id },
    { op: 'replace', path: '/tags', value: picked.tags },
    { op: 'replace', path: '/billable', value: picked.billable },
  ]);
  await expect.poll(async () => metadataOf((await api.entries()).find(e => e.id === target.id)!)).toEqual(picked);

  // The list is open with a match, but nothing is highlighted: Enter commits the typed text only.
  await description.fill('Suggest');
  await expect(option).toBeVisible();
  await expect(suggestions.getByRole('option', { selected: true })).toHaveCount(0);
  await description.press('Enter');
  await expect(description).not.toBeFocused();
  await expectNoFurtherWrites(page, writes, 2);
  expect(writes[1]!.method).toBe('PATCH');
  expect(bulkIds(writes[1]!)).toEqual([target.id]);
  expect(writes[1]!.body).toEqual([{ op: 'replace', path: '/description', value: 'Suggest' }]);
  await expect
    .poll(async () => metadataOf((await api.entries()).find(e => e.id === target.id)!))
    .toEqual({ ...picked, description: 'Suggest' });
});

test('a pick on a collapsed group row updates every member in one request', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const picked = await seedSuggestion(api, daysAgo(3));
  const members = [
    await api.createEntry({
      description: 'Pair work',
      start: `${daysAgo(1)}T09:00:00Z`,
      stop: `${daysAgo(1)}T10:00:00Z`,
    }),
    await api.createEntry({
      description: 'Pair work',
      start: `${daysAgo(1)}T11:00:00Z`,
      stop: `${daysAgo(1)}T12:00:00Z`,
    }),
  ];
  const memberIds = members.map(entry => entry.id).sort((a, b) => a - b);
  await page.reload();

  // Collapse similar entries is on by default.
  const group = page.locator('.entry-row-wrap.grouped', { has: page.locator('.count-badge', { hasText: '2' }) });
  await expect(group).toHaveCount(1);
  const line = group.locator('.entry-line').first();
  const description = line.getByRole('combobox', { name: 'Description' });
  await expect(description).toHaveValue('Pair work');
  const writes = recordEntryWrites(page);

  await description.click();
  await description.fill('Sugg');
  const option = line
    .getByRole('listbox', { name: 'Suggestions' })
    .getByRole('option', { name: SUGGESTION.description });
  await expect(option).toBeVisible();
  await description.press('ArrowDown');
  await description.press('Enter');
  await expect(line.locator('.project-label')).toContainText(SUGGESTION.label);
  await expect(group).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expectNoFurtherWrites(page, writes, 1);
  expect(writes[0]!.method).toBe('PATCH');
  expect(bulkIds(writes[0]!)).toEqual(memberIds);
  expect(paths(writes[0]!)).toEqual(SUGGESTION_PATHS);
  await expect
    .poll(async () =>
      (await api.entries()).filter(entry => memberIds.includes(entry.id)).map(entry => metadataOf(entry)),
    )
    .toEqual([picked, picked]);
});
