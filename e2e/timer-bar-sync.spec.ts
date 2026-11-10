import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { metadataOf, nextRunning, TimerApi } from './timer-tests-helpers.ts';

// Forces two races every run: a same-second edit leaves `at` unchanged, and typing before the running entry's
// first load. The stream answers 204, so the page learns of changes only by reading the timer state.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const TIMER_STATE = (url: URL) => url.pathname === '/api/app/timer';

test.beforeEach(async ({ page }) => {
  // A 204 closes an EventSource for good; the app retries every few seconds and gets 204 again.
  await page.route('**/api/app/timer/events', route => route.fulfill({ status: 204 }));
});

async function remotePut(page: Page, api: TimerApi, id: number, changes: Record<string, unknown>) {
  const response = await page.request.put(`/api/v9/workspaces/${api.workspaceId}/time_entries/${id}`, {
    headers: CSRF,
    data: changes,
  });
  expect(response.ok()).toBe(true);
}

/** A state is fresh for a second, and the focus handler runs at most once a second, so it waits that out. */
async function refetchOnFocus(page: Page) {
  await page.waitForTimeout(1_100);
  const refetched = page.waitForResponse(response => TIMER_STATE(new URL(response.url())) && response.ok());
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
  const raw = (await (await page.request.get('/api/app/timer')).json()) as { running_entry: { at: string } };

  // "at" has whole-second precision; pin it so a same-second write happens every run.
  await page.route(TIMER_STATE, async route => {
    const response = await route.fetch();
    const body = (await response.json()) as { running_entry: { at?: string } | null };
    const entry = body.running_entry && { ...body.running_entry, at: raw.running_entry.at };
    await route.fulfill({ response, json: { ...body, running_entry: entry } });
  });
  await remotePut(page, api, running.id, { description: 'Renamed elsewhere', tags: ['remote'], billable: true });
  await refetchOnFocus(page);
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(timer.getByLabel('Description')).toHaveValue('Renamed elsewhere');

  const description = timer.getByLabel('Description');
  await description.fill('Typed here');
  await remotePut(page, api, running.id, { tags: ['remote', 'second'] });
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

  // Hold timer state reads and the Start reply until the edits are done; the server starts the entry at once.
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(TIMER_STATE, async route => {
    await gate;
    await route.continue();
  });
  const START = (url: URL) => url.pathname === '/api/app/timer/start';
  await page.route(START, async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const sent = page.waitForRequest(request => START(new URL(request.url())));
  const started = page.waitForResponse(response => START(new URL(response.url())));
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await sent;

  await timer.getByLabel('Description').fill('Draft the spec');
  await timer.getByLabel('Description').blur();
  await timer.getByRole('button', { name: 'Billable' }).click();
  release();
  const entry = ((await (await started).json()) as { running_entry: { id: number } }).running_entry;

  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect
    .poll(async () => metadataOf((await api.current())!))
    .toEqual({
      description: 'Draft the spec',
      project_id: null,
      task_id: null,
      tags: [],
      billable: true,
    });
  expect((await api.entries()).map(saved => saved.id)).toEqual([entry.id]);
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
    headers: CSRF,
    data: {
      description: 'Remote timer',
      tags: ['remote'],
      start: new Date().toISOString(),
      duration: -1,
      created_with: 'e2e',
    },
  });
  expect(response.ok()).toBe(true);
  await refetchOnFocus(page);
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(description).toHaveValue('Remote timer');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  const running = await api.current();
  expect(running?.description).toBe('Remote timer');
});
