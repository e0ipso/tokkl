import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { OtherDevice, countPolls, daysAgo, entryRow, setVisibility } from './groups-refresh-tests-helpers.ts';

// docs/PRD.md C3: timer changes come over the event stream, the history refetches every 60 s and on focus,
// and the timer state polls every 30 s only while the stream is down.

let device: OtherDevice;
test.beforeEach(async ({ baseURL }) => {
  device = await OtherDevice.open(baseURL!);
});
test.afterEach(async () => {
  await device.close();
});

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;

test('Show more days follows older entries added and deleted on another device', async ({ page }) => {
  await page.clock.install();
  const bounds = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/bounds');
  await login(page);
  await bounds;
  await expect(page.getByText('No time entries in this period')).toBeVisible();
  const more = page.getByRole('button', { name: 'Show 14 more days' });
  await expect(more).toHaveCount(0);

  const old = await device.createEntry({
    description: 'Older history',
    start: at(daysAgo(20), 9),
    stop: at(daysAgo(20), 10),
  });
  await page.clock.fastForward(60_000);
  await expect(more).toBeVisible();
  await expect(entryRow(page, 'Older history')).toHaveCount(0);

  await device.deleteEntry(old.id);
  await page.clock.fastForward(60_000);
  await expect(more).toHaveCount(0);
});

test("another device's timer changes arrive by push and its history edits through the 60-second poll", async ({
  page,
}) => {
  const history = await device.createEntry({
    description: 'Old history',
    start: at(daysAgo(1), 9),
    stop: at(daysAgo(1), 10),
  });
  // The fake clock runs at normal speed; fastForward jumps it and fires each due interval once.
  await page.clock.install();
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  const polls = countPolls(page);

  // This runs first: the one-minute jump below outlasts the stream's silence timeout, whose replacement rereads.
  const remote = await device.startTimer('Remote timer');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Remote timer');
  await device.stopTimer(remote.id);
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await expect(entryRow(page, 'Remote timer')).toHaveCount(1);
  expect(polls.timer).toBe(0);

  const pushed = polls.history;
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  expect(polls.history).toBe(pushed);
  await page.clock.fastForward(60_000);
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect(entryRow(page, 'Old history')).toHaveCount(0);
  await expect.poll(() => polls.history).toBe(pushed + 1);
});

test("making the window visible again refreshes another device's history edit at once", async ({ page }) => {
  const history = await device.createEntry({
    description: 'Old history',
    start: at(daysAgo(1), 9),
    stop: at(daysAgo(1), 10),
  });
  await login(page);
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  // The stream's first state is fresh for a second (`staleTime`); past that focus rereads the timer state.
  await page.waitForTimeout(1_100);
  const polls = countPolls(page);

  await setVisibility(page, 'hidden');
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  expect(polls).toEqual({ timer: 0, history: 0 });

  // Well inside the poll interval, so only the visibility change can fetch.
  await setVisibility(page, 'visible');
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect.poll(() => ({ ...polls })).toEqual({ timer: 1, history: 1 });
});

// Clicking back into a window that stayed visible, such as one beside another app, fires focus
// but no visibilitychange.
test("focusing a window that stayed visible refreshes another device's history edit at once", async ({ page }) => {
  const history = await device.createEntry({
    description: 'Old history',
    start: at(daysAgo(1), 9),
    stop: at(daysAgo(1), 10),
  });
  await login(page);
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  // The stream's first state is fresh for a second (`staleTime`); past that focus rereads the timer state.
  await page.waitForTimeout(1_100);
  const polls = countPolls(page);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect.poll(() => ({ ...polls })).toEqual({ timer: 1, history: 1 });
});

test('a refresh keeps the description being typed in the running timer and in a list row', async ({ page }) => {
  const remote = await device.startTimer('Remote timer');
  const other = await device.createEntry({
    description: 'Other history',
    start: at(daysAgo(1), 9),
    stop: at(daysAgo(1), 10),
  });
  await device.createEntry({ description: 'Old history', start: at(daysAgo(2), 9), stop: at(daysAgo(2), 10) });
  await page.clock.install();
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer.getByLabel('Description')).toHaveValue('Remote timer');
  await expect(page.locator('.entry-list .entry-line')).toHaveCount(2);
  // The typed text replaces the value attribute, so the row is held by position.
  const row = page.locator('.entry-list .entry-line').nth(1);
  const oldId = [...(await device.entries()).values()].find(entry => entry.description === 'Old history')!.id;

  const timerDescription = timer.getByLabel('Description');
  await timerDescription.fill('Local timer draft');
  await device.updateEntry(remote.id, { description: 'Renamed elsewhere', tags: ['remote'] });
  await device.updateEntry(other.id, { description: 'Other edited' });
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  await expect(entryRow(page, 'Other edited')).toHaveCount(1);
  await expect(timerDescription).toBeFocused();
  await expect(timerDescription).toHaveValue('Local timer draft');

  const rowDescription = row.getByLabel('Description');
  await rowDescription.fill('Local row draft');
  await device.updateEntry(other.id, { description: 'Other edited again' });
  await page.clock.fastForward(60_000);
  await expect(entryRow(page, 'Other edited again')).toHaveCount(1);
  await expect(rowDescription).toBeFocused();
  await expect(rowDescription).toHaveValue('Local row draft');

  await rowDescription.press('Enter');
  await expect.poll(async () => (await device.entries()).get(oldId)?.description).toBe('Local row draft');
});

// Grouped rows merge by description, project, task, tags and billable, so an edit must not remount the row.
test('a refresh keeps an unsaved row description when another device edits that entry', async ({ page }) => {
  await device.createEntry({ description: 'Old history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  const project = await device.createProject('Acme');
  await page.clock.install();
  await login(page);
  await expect(page.locator('.entry-list .entry-line')).toHaveCount(1);
  const row = page.locator('.entry-list .entry-line').first();
  const rowDescription = row.getByLabel('Description');
  const id = [...(await device.entries()).keys()][0]!;

  await rowDescription.fill('Local row draft');
  await device.updateEntry(id, { project_id: project.id });
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect(row.locator('.project-label')).toContainText('Acme');
  await expect(rowDescription).toBeFocused();
  await expect(rowDescription).toHaveValue('Local row draft');

  await device.updateEntry(id, { description: 'Renamed elsewhere' });
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v9/me/time_entries');
  await page.clock.fastForward(60_000);
  await refreshed;
  await expect(rowDescription).toBeFocused();
  await expect(rowDescription).toHaveValue('Local row draft');

  await rowDescription.press('Enter');
  await expect.poll(async () => (await device.entries()).get(id)?.description).toBe('Local row draft');
});
