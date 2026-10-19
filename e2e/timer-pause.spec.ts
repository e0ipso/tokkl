import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';
import { holdNextStop, instant, metadataOf, nextRunning, TimerApi, type EntryView, type Metadata } from './timer-tests-helpers.ts';

// Pause stops the running entry and Resume starts a clone of it. The clock adds up the chain of
// stopped entries and the running clone until Stop. Stopped entries snap to the time resolution,
// so the expected totals come from the stored entries, not from the time the test waited.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const CURRENT = /\/api\/v9\/me\/time_entries\/current/;
const CHAIN_PREFIX = 'tokkl.pauseChain.';

function seconds(clock: string): number {
  const [h, m, s] = clock.split(':').map(Number);
  return h! * 3600 + m! * 60 + s!;
}

function clockText(total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Seconds the stopped entries store, which is the paused total. */
async function storedTotal(api: TimerApi): Promise<number> {
  const stopped = (await api.entries()).filter((entry) => entry.stop !== null);
  return stopped.reduce((sum, entry) => sum + (instant(entry.stop) - instant(entry.start)) / 1000, 0);
}

async function refetchOnFocus(page: Page) {
  // The focus refetch is throttled to one a second.
  await page.waitForTimeout(1_100);
  const refetched = page.waitForResponse((response) => CURRENT.test(response.url()) && response.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refetched;
}

async function storedChains(page: Page): Promise<string[]> {
  return page.evaluate((prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)), CHAIN_PREFIX);
}

/** A running entry with every field Resume copies, seeded as another device would start it. */
async function seedRunning(page: Page, api: TimerApi): Promise<{ running: EntryView; metadata: Metadata }> {
  const project = await api.createProject('Pause project');
  const task = await api.createTask(project, 'Pause task');
  const metadata: Metadata = { description: 'Paused work', project_id: project, task_id: task, tags: ['focus', 'web'], billable: true };
  const running = await api.startTimer({ ...metadata, start: new Date(Date.now() - 90_000).toISOString() });
  await page.reload();
  return { running, metadata };
}

function bar(page: Page) {
  const timer = page.getByRole('region', { name: 'Timer' });
  return {
    timer,
    pause: timer.getByRole('button', { name: 'Pause timer' }),
    resume: timer.getByRole('button', { name: 'Resume timer' }),
    stop: timer.getByRole('button', { name: 'Stop timer' }),
    start: timer.getByRole('button', { name: 'Start timer' }),
    runningClock: timer.getByRole('button', { name: /elapsed, edit start time$/ }),
    pausedClock: timer.getByRole('timer', { name: /elapsed, paused$/ }),
    pausedLabel: timer.getByText('Paused', { exact: true }),
    announcer: timer.locator('[aria-live="polite"]'),
  };
}

async function runningSeconds(clock: Locator): Promise<number> {
  return seconds((await clock.textContent())!.trim());
}

test('Pause freezes the chain total, Resume clones the entry across cycles, and Stop ends the chain', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { running, metadata } = await seedRunning(page, api);
  const ui = bar(page);
  await expect(ui.pause).toBeVisible();
  await expect(ui.stop).toBeVisible();

  let previousId = running.id;
  for (let cycle = 1; cycle <= 3; cycle++) {
    await ui.pause.click();
    await expect(ui.resume).toBeVisible();
    await expect(ui.pause).toHaveCount(0);
    await expect(ui.pausedLabel).toBeVisible();
    await expect(ui.announcer).toHaveText('Timer paused');
    await expect.poll(() => api.current()).toBeNull();
    const stopped = await api.entries();
    expect(stopped).toHaveLength(cycle);
    for (const entry of stopped) expect(metadataOf(entry)).toEqual(metadataOf(metadata));

    const total = await storedTotal(api);
    await expect(ui.pausedClock).toHaveText(clockText(total));
    await expect(ui.pausedClock).toHaveAccessibleName(`${clockText(total)} elapsed, paused`);
    await page.waitForTimeout(1_500);
    await expect(ui.pausedClock).toHaveText(clockText(total));
    // The bar keeps showing what Resume will start.
    await expect(ui.timer.getByLabel('Description')).toHaveValue(metadata.description);

    await ui.resume.click();
    const clone = await nextRunning(api, previousId);
    expect(metadataOf(clone)).toEqual(metadataOf(metadata));
    previousId = clone.id;
    await expect(ui.announcer).toHaveText('Timer resumed');
    await expect(ui.pausedLabel).toHaveCount(0);
    await expect(ui.timer.getByText('Running', { exact: true })).toBeVisible();
    // The clock continues from the paused total.
    await expect.poll(() => runningSeconds(ui.runningClock)).toBeGreaterThanOrEqual(total + 1);
    expect(await runningSeconds(ui.runningClock)).toBeLessThan(total + 60);
  }

  // Stop while paused clears the chain and writes nothing: the entries are already stopped.
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/time_entries')) writes.push(`${request.method()} ${request.url()}`);
  });
  const before = await api.entries();
  await ui.stop.click();
  await expect(ui.start).toBeVisible();
  await expect(ui.pausedLabel).toHaveCount(0);
  await expect(ui.announcer).toHaveText('');
  await expect(ui.timer.getByLabel('Duration')).toHaveValue('');
  expect(await storedChains(page)).toEqual([]);
  expect(await api.entries()).toEqual(before);
  expect(writes).toEqual([]);

  // The next start shows its own time from 0:00.
  await ui.timer.getByLabel('Description').fill('After the chain');
  await ui.start.click();
  const fresh = await nextRunning(api, null);
  await expect(ui.runningClock).toHaveText(/^0:00:0\d$/);

  // Stop while a clone runs stops it and ends the chain too.
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await ui.resume.click();
  const freshClone = await nextRunning(api, fresh.id);
  await expect(ui.pause).toBeVisible();
  await ui.stop.click();
  await expect(ui.start).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();
  expect((await api.entries()).find((entry) => entry.id === freshClone.id)?.stop).not.toBeNull();
  expect(await storedChains(page)).toEqual([]);
  await expect(ui.resume).toHaveCount(0);
});

test('a reload while paused keeps the chain, and Resume after it clones the entry', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { running, metadata } = await seedRunning(page, api);
  const ui = bar(page);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();
  const total = await storedTotal(api);
  expect(await storedChains(page)).toHaveLength(1);

  await page.reload();
  await expect(ui.resume).toBeVisible();
  await expect(ui.pausedLabel).toBeVisible();
  await expect(ui.pausedClock).toHaveText(clockText(total));
  await expect(ui.timer.getByLabel('Description')).toHaveValue(metadata.description);
  await expect(ui.timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ui.timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'focus, web');

  await ui.resume.click();
  const clone = await nextRunning(api, running.id);
  expect(metadataOf(clone)).toEqual(metadataOf(metadata));
  await expect.poll(() => runningSeconds(ui.runningClock)).toBeGreaterThanOrEqual(total + 1);

  // A reload while the clone runs keeps the total as well.
  await page.reload();
  await expect(ui.pause).toBeVisible();
  expect(await runningSeconds(ui.runningClock)).toBeGreaterThanOrEqual(total);
  expect(await runningSeconds(ui.runningClock)).toBeLessThan(total + 60);
});

test('Stop pressed while Resume is starting the clone leaves no timer running', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  await seedRunning(page, api);
  const ui = bar(page);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();

  // Hold the clone's start request, like a slow network, until Stop has been pressed.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const isStart = (method: string, url: string) => method === 'POST' && /\/time_entries\?/.test(url);
  await page.route(/\/time_entries\?/, async (route) => {
    if (isStart(route.request().method(), route.request().url())) await gate;
    await route.continue();
  });
  const sent = page.waitForRequest((request) => isStart(request.method(), request.url()));
  const created = page.waitForResponse((response) => isStart(response.request().method(), response.url()));
  await ui.resume.click();
  await sent;
  await ui.stop.click();
  await expect(ui.start).toBeVisible();
  release();
  const clone = await (await created).json() as { id: number };

  await expect.poll(async () => (await api.entries()).find((entry) => entry.id === clone.id)?.stop ?? null).not.toBeNull();
  expect(await api.current()).toBeNull();
  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
  await expect(ui.timer.getByLabel('Duration')).toHaveValue('');
  await expect(ui.timer.getByLabel('Duration')).toHaveAttribute('placeholder', '0:00:00');
  expect(await storedChains(page)).toEqual([]);
});

test('Stop pressed while Pause is stopping the entry sends no second stop and ends the chain', async ({ page, users }) => {
  await loginAs(page, (await users.create()).account);
  const api = await TimerApi.open(page);
  await seedRunning(page, api);
  const ui = bar(page);
  await expect(ui.pause).toBeVisible();

  const held = await holdNextStop(page);
  await ui.pause.click();
  await held.sent;
  await ui.stop.click();
  held.release();

  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
  expect(held.stops.count).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await api.current()).toBeNull();
  expect(await api.entries()).toHaveLength(1);
  await expect(ui.timer.getByLabel('Description')).toHaveValue('');
  expect(await storedChains(page)).toEqual([]);
});

test('a paused chain from another tab fills the draft, and an edit there keeps its metadata on Resume', async ({ page, context }) => {
  await login(page);
  const api = await TimerApi.open(page);
  // This tab never sees the entry run: its current-entry requests answer that nothing runs, as if
  // the other tab started and paused it before this tab's next poll.
  await page.route(CURRENT, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  const { running, metadata } = await seedRunning(page, api);
  const ui = bar(page);
  await expect(ui.start).toBeVisible();

  const other = await context.newPage();
  await other.goto('/');
  const otherUi = bar(other);
  await otherUi.pause.click();
  await expect(otherUi.resume).toBeVisible();

  await expect(ui.resume).toBeVisible();
  await expect(ui.timer.getByLabel('Description')).toHaveValue(metadata.description);
  await expect(ui.timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ui.timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'focus, web');
  await expect(ui.timer.getByRole('button', { name: 'Project' })).toContainText('Pause project');

  await ui.timer.getByLabel('Description').fill('Edited in this tab');
  await ui.timer.getByLabel('Description').blur();
  await page.unroute(CURRENT);
  await ui.resume.click();
  const clone = await nextRunning(api, running.id);
  expect(metadataOf(clone)).toEqual(metadataOf({ ...metadata, description: 'Edited in this tab' }));
  await other.close();
});

test('signing out forgets the paused chain', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  await seedRunning(page, api);
  const ui = bar(page);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  expect(await storedChains(page)).toHaveLength(1);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await storedChains(page)).toEqual([]);
  await login(page);
  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
});

test('a timer started on another client ends a paused chain, and so does stopping the clone there', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { running } = await seedRunning(page, api);
  const ui = bar(page);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();

  // Another device starts a timer: the bar shows it with its own time, not the paused total.
  const remote = await api.startTimer({ description: 'Started elsewhere', start: new Date().toISOString() });
  await refetchOnFocus(page);
  await expect(ui.timer.getByLabel('Description')).toHaveValue('Started elsewhere');
  await expect(ui.pausedLabel).toHaveCount(0);
  await expect(ui.resume).toHaveCount(0);
  expect(await runningSeconds(ui.runningClock)).toBeLessThan(30);
  await expect.poll(() => storedChains(page)).toEqual([]);

  // A new chain from the remote entry; then another device stops its clone.
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await ui.resume.click();
  const clone = await nextRunning(api, remote.id);
  expect(clone.id).not.toBe(running.id);
  await expect(ui.pause).toBeVisible();
  const stopped = await page.request.patch(`/api/v9/workspaces/${api.workspaceId}/time_entries/${clone.id}/stop`, { headers: CSRF });
  expect(stopped.ok()).toBe(true);
  await refetchOnFocus(page);
  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
  await expect.poll(() => storedChains(page)).toEqual([]);
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the bar with Pause and Stop, or Resume and Stop, fits the screen', async ({ page }) => {
    await login(page);
    const api = await TimerApi.open(page);
    await seedRunning(page, api);
    const ui = bar(page);
    await expect(ui.pause).toBeVisible();
    await expectNoPageOverflow(page);
    for (const control of [ui.pause, ui.stop, ui.runningClock]) await expectFits(control);

    await ui.pause.tap();
    await expect(ui.resume).toBeVisible();
    await expectNoPageOverflow(page);
    for (const control of [ui.resume, ui.stop, ui.pausedClock, ui.pausedLabel]) await expectFits(control);
  });
});
