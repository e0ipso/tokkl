import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';
import {
  holdRequest, instant, metadataOf, nextRunning, openSecondDevice, settleTimerTraffic, TimerApi, watchTimerTraffic,
  type EntryView, type Metadata,
} from './timer-tests-helpers.ts';

// Pause stops the running entry and Resume starts a clone of it, both on the server. The clock adds
// up the chain of stopped entries and the running clone until Stop. Stopped entries snap to the
// time resolution, so the expected totals come from the stored entries, not from the time the test
// waited.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const PAUSE = /\/api\/app\/timer\/pause$/;
const RESUME = /\/api\/app\/timer\/resume$/;

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

/**
 * A running entry with every field Resume copies, seeded as another device would start it ten
 * minutes ago. A timer paused seconds after it started rounds to zero and goes to the trash.
 */
async function seedRunning(page: Page, api: TimerApi): Promise<{ running: EntryView; metadata: Metadata }> {
  const project = await api.createProject('Pause project');
  const task = await api.createTask(project, 'Pause task');
  const metadata: Metadata = { description: 'Paused work', project_id: project, task_id: task, tags: ['focus', 'web'], billable: true };
  const running = await api.startTimer({ ...metadata, start: new Date(Date.now() - 10 * 60_000).toISOString() });
  await page.reload();
  return { running, metadata };
}

interface Chain {
  paused: boolean;
  seconds: number;
  clone_entry_id: number | null;
}

/** The pause chain the server holds for the signed-in user. */
async function chainOf(page: Page): Promise<Chain | null> {
  return ((await (await page.request.get('/api/app/timer')).json()) as { pause: Chain | null }).pause;
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
    // Each clone is paused seconds after it started, so it rounds to zero and goes to the trash,
    // and only the seed adds to the total.
    const stopped = await api.entries();
    const trashed = await api.trash();
    expect(stopped).toHaveLength(1);
    expect(trashed).toHaveLength(cycle - 1);
    for (const entry of [...stopped, ...trashed]) expect(metadataOf(entry)).toEqual(metadataOf(metadata));

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
  let discards = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/time_entries')) writes.push(`${request.method()} ${request.url()}`);
    if (request.method() === 'POST' && request.url().endsWith('/api/app/timer/discard')) discards++;
  });
  const before = await api.entries();
  await ui.stop.click();
  await expect(ui.start).toBeVisible();
  await expect(ui.pausedLabel).toHaveCount(0);
  await expect(ui.announcer).toHaveText('');
  await expect(ui.timer.getByLabel('Duration')).toHaveValue('');
  expect(await chainOf(page)).toBeNull();
  expect(await api.entries()).toEqual(before);
  expect(writes).toEqual([]);
  expect(discards).toBe(1);

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
  // Stopped seconds after it started, the clone rounds to zero and goes to the trash.
  expect((await api.trash()).map((entry) => entry.id)).toContain(freshClone.id);
  expect(await chainOf(page)).toBeNull();
  await expect(ui.resume).toHaveCount(0);
});

test('a reload while paused shows the chain from the server, and Resume after it clones the entry', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { running, metadata } = await seedRunning(page, api);
  const ui = bar(page);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();
  const total = await storedTotal(api);

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

test('Stop does nothing while Pause or Resume is in flight, and the press is not remembered', async ({ page }) => {
  await watchTimerTraffic(page);
  await login(page);
  const api = await TimerApi.open(page);
  const { running } = await seedRunning(page, api);
  const ui = bar(page);
  const ended: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/(stop|discard)$/.test(new URL(request.url()).pathname)) ended.push(request.url());
  });

  // Hold Pause's request on its way to the server. The bar locks, and the S shortcut is ignored.
  const pause = await holdRequest(page, PAUSE);
  await ui.pause.click();
  await pause.sent;
  for (const control of [ui.pause, ui.stop]) await expect(control).toBeDisabled();
  await page.keyboard.press('s');
  pause.release();
  await expect(ui.resume).toBeVisible();
  await expect(ui.stop).toBeEnabled();
  await settleTimerTraffic(page);
  expect(await chainOf(page)).toMatchObject({ paused: true, clone_entry_id: null });
  expect(await api.current()).toBeNull();

  // The same for Resume: the clone starts and keeps running.
  const resume = await holdRequest(page, RESUME);
  await ui.resume.click();
  await resume.sent;
  for (const control of [ui.resume, ui.stop]) await expect(control).toBeDisabled();
  await page.keyboard.press('s');
  resume.release();
  const clone = await nextRunning(api, running.id);
  await expect(ui.pause).toBeVisible();
  await expect(ui.stop).toBeEnabled();
  await settleTimerTraffic(page);
  expect((await api.current())?.id).toBe(clone.id);
  expect(await chainOf(page)).toMatchObject({ paused: false, clone_entry_id: clone.id });
  expect(ended).toEqual([]);

  // The shortcut works again once nothing is in flight.
  await page.keyboard.press('s');
  await expect(ui.start).toBeVisible();
  expect(ended).toHaveLength(1);
});

test('a pause on one device shows on another with the same total, and Resume there starts the clone here', async ({ page, browser }, testInfo) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { running, metadata } = await seedRunning(page, api);
  const { other, errors } = await openSecondDevice(page, browser);
  const here = bar(page);
  const there = bar(other);
  await expect(there.pause).toBeVisible();

  // Nothing reloads or focuses the other device: the server pushes the pause.
  await here.pause.click();
  await expect(here.resume).toBeVisible();
  await expect(there.resume).toBeVisible({ timeout: 2_000 });
  await expect(there.pausedLabel).toBeVisible();
  const total = await storedTotal(api);
  await expect(there.pausedClock).toHaveText(clockText(total));
  await expect(here.pausedClock).toHaveText(clockText(total));
  // The server holds the fields Resume copies, so no device edits them while paused.
  await expect(there.timer.getByLabel('Description')).toHaveValue(metadata.description);
  await expect(there.timer.getByLabel('Description')).not.toBeEditable();
  await expect(there.timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(there.timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'focus, web');
  await expect(there.timer.getByRole('button', { name: 'Project' })).toContainText('Pause project');

  await there.resume.click();
  const clone = await nextRunning(api, running.id);
  expect(metadataOf(clone)).toEqual(metadataOf(metadata));
  await expect(here.pause).toBeVisible({ timeout: 2_000 });
  await expect(here.pausedLabel).toHaveCount(0);
  await expect.poll(() => runningSeconds(here.runningClock)).toBeGreaterThanOrEqual(total + 1);
  expect(await runningSeconds(here.runningClock)).toBeLessThan(total + 60);

  // Stop while paused on one device ends the chain on the other.
  await here.pause.click();
  await expect(there.resume).toBeVisible({ timeout: 2_000 });
  await there.stop.click();
  await expect(there.start).toBeVisible();
  await expect(here.start).toBeVisible({ timeout: 2_000 });
  await expect(here.resume).toHaveCount(0);
  expect(await chainOf(page)).toBeNull();
  await errors.verify(testInfo);
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
  await expect(ui.timer.getByLabel('Description')).toHaveValue('Started elsewhere');
  await expect(ui.pausedLabel).toHaveCount(0);
  await expect(ui.resume).toHaveCount(0);
  expect(await runningSeconds(ui.runningClock)).toBeLessThan(30);
  expect(await chainOf(page)).toBeNull();

  // A new chain from the remote entry; then another device stops its clone.
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await ui.resume.click();
  const clone = await nextRunning(api, remote.id);
  expect(clone.id).not.toBe(running.id);
  await expect(ui.pause).toBeVisible();
  const stopped = await page.request.patch(`/api/v9/workspaces/${api.workspaceId}/time_entries/${clone.id}/stop`, { headers: CSRF });
  expect(stopped.ok()).toBe(true);
  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
  expect(await chainOf(page)).toBeNull();
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
