import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { metadataOf, nextRunning, TimerApi } from './timer-tests-helpers.ts';

// The timer bar mirrors the running entry. These scenarios pin two races and force them on every
// run, so they fail every time instead of only under load.
// Same-second edit: the server reports `at` with whole-second precision. An edit to the running
// entry saved in the same second as its previous write leaves `at` unchanged, so the timer bar used
// to keep the old project, tags or billable flag.
// Typing before the first load: text typed into the description after Start but before the running
// entry's first load had no entry for the blur handler to patch, and the first load then replaced
// the draft with the description sent at start.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const CURRENT = /\/api\/v9\/me\/time_entries\/current/;

/** Another device writes through the same account; the page only learns of it on a refetch. */
async function remotePut(page: Page, api: TimerApi, id: number, changes: Record<string, unknown>) {
  const response = await page.request.put(`/api/v9/workspaces/${api.workspaceId}/time_entries/${id}`, { headers: CSRF, data: changes });
  expect(response.ok()).toBe(true);
}

async function refetchOnFocus(page: Page) {
  const refetched = page.waitForResponse((response) => CURRENT.test(response.url()) && response.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refetched;
}

test('a remote edit shows in the timer bar even when the entry keeps the same "at" second', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Local');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  const raw = await (await page.request.get('/api/v9/me/time_entries/current')).json() as { at: string };

  // "at" has whole-second precision, so a write in the same second leaves it unchanged. Pin it
  // to make that happen on every run.
  await page.route(CURRENT, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { at?: string } | null;
    await route.fulfill({ response, json: body ? { ...body, at: raw.at } : body });
  });
  await remotePut(page, api, running.id, { description: 'Renamed elsewhere', tags: ['remote'], billable: true });
  await refetchOnFocus(page);
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(timer.getByLabel('Description')).toHaveValue('Renamed elsewhere');

  // Focused typing still survives such a refetch.
  const description = timer.getByLabel('Description');
  await description.fill('Typed here');
  await remotePut(page, api, running.id, { tags: ['remote', 'second'] });
  await page.waitForTimeout(1_100); // the focus refetch is throttled to once a second
  await refetchOnFocus(page);
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote, second');
  await expect(description).toBeFocused();
  await expect(description).toHaveValue('Typed here');
});

test('edits made right after Start, before the running entry loads, are saved to it', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Draft');

  // Hold every current-entry response until the edits are done, like a slow server.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(CURRENT, async (route) => {
    await gate;
    await route.continue();
  });
  const created = page.waitForResponse((response) => response.request().method() === 'POST' && /\/time_entries\?/.test(response.url()));
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const entry = await (await created).json() as { id: number };

  await timer.getByLabel('Description').fill('Draft the spec');
  await timer.getByLabel('Description').blur();
  await timer.getByRole('button', { name: 'Billable' }).click();
  // Later current-entry requests pass straight through the open gate.
  release();

  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect.poll(async () => metadataOf((await api.current())!)).toEqual({
    description: 'Draft the spec', project_id: null, task_id: null, tags: [], billable: true,
  });
  expect((await api.entries()).map((saved) => saved.id)).toEqual([entry.id]);
  await expect(timer.getByLabel('Description')).toHaveValue('Draft the spec');
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
});

test('a timer started on another device replaces the idle bar draft', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  const description = timer.getByLabel('Description');
  await description.fill('Idle draft');

  const response = await page.request.post(`/api/v9/workspaces/${api.workspaceId}/time_entries`, {
    headers: CSRF, data: { description: 'Remote timer', tags: ['remote'], start: new Date().toISOString(), duration: -1, created_with: 'e2e' },
  });
  expect(response.ok()).toBe(true);
  await refetchOnFocus(page);
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(description).toHaveValue('Remote timer');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  const running = await api.current();
  expect(running?.description).toBe('Remote timer');
});
