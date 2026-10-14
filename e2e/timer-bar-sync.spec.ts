import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { nextRunning, TimerApi } from './timer-tests-helpers.ts';

// The timer bar mirrors the running entry. These scenarios pin the races behind TT-0061 and
// TT-0062 so they fail every time instead of only under load.

const CSRF = { 'X-Timetrack-CSRF': '1' };
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
