import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { OtherDevice, countPolls, daysAgo, entryRow, setVisibility } from './groups-refresh-tests-helpers.ts';

// Cross-device freshness (docs/PRD.md C3): the running timer refetches every 30 s and on window
// focus, the history every 60 s. There is no realtime service; another device changes entries
// through the API while this page only watches.

let device: OtherDevice;
test.beforeEach(async ({ baseURL }) => { device = await OtherDevice.open(baseURL!); });
test.afterEach(async () => { await device.close(); });

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;

test('another device\'s timer and history changes arrive through the 30- and 60-second polls', async ({ page }) => {
  const history = await device.createEntry({ description: 'Old history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  // The fake clock runs at normal speed; fastForward jumps it and fires each due interval once.
  // Both polls start when the timer page mounts, so the first jump crosses the 30-second tick
  // only and the second one also crosses the 60-second tick.
  await page.clock.install();
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  const polls = countPolls(page);

  const remote = await device.startTimer('Remote timer');
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  expect(polls).toEqual({ current: 0, history: 0 });

  await page.clock.fastForward(30_000);
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Remote timer');
  await expect.poll(() => ({ ...polls })).toEqual({ current: 1, history: 0 });
  await expect(entryRow(page, 'Old history')).toHaveCount(1);

  await page.clock.fastForward(30_000);
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect(entryRow(page, 'Old history')).toHaveCount(0);
  await expect.poll(() => ({ ...polls })).toEqual({ current: 2, history: 1 });

  // A stop on the other device reaches the timer at the next 30-second tick and the history at
  // the next 60-second one.
  await device.stopTimer(remote.id);
  await page.clock.fastForward(30_000);
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await expect.poll(() => ({ ...polls })).toEqual({ current: 3, history: 1 });
  await expect(entryRow(page, 'Remote timer')).toHaveCount(0);
  await page.clock.fastForward(30_000);
  await expect(entryRow(page, 'Remote timer')).toHaveCount(1);
  await expect.poll(() => ({ ...polls })).toEqual({ current: 4, history: 2 });
});

test('making the window visible again refreshes another device\'s changes at once', async ({ page }) => {
  const history = await device.createEntry({ description: 'Old history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  const polls = countPolls(page);

  await setVisibility(page, 'hidden');
  await device.startTimer('Remote timer');
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  expect(polls).toEqual({ current: 0, history: 0 });

  // Well inside both poll intervals, so only the visibility change can fetch.
  await setVisibility(page, 'visible');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Remote timer');
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect.poll(() => ({ ...polls })).toEqual({ current: 1, history: 1 });
});

// The app refetches on visibilitychange only (TanStack Query v5 dropped the window focus
// listener). Clicking back into a window that stayed visible, such as one beside another app,
// fires focus but no visibilitychange, so nothing refreshes.
test.fixme('TT-0059: focusing a window that stayed visible refreshes another device\'s changes at once', async ({ page }) => {
  const history = await device.createEntry({ description: 'Old history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(entryRow(page, 'Old history')).toHaveCount(1);
  const polls = countPolls(page);

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await device.startTimer('Remote timer');
  await device.updateEntry(history.id, { description: 'Edited elsewhere' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(entryRow(page, 'Edited elsewhere')).toHaveCount(1);
  await expect.poll(() => ({ ...polls })).toEqual({ current: 1, history: 1 });
});

test('a refresh keeps the description being typed in the running timer and in a list row', async ({ page }) => {
  const remote = await device.startTimer('Remote timer');
  const other = await device.createEntry({ description: 'Other history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  await device.createEntry({ description: 'Old history', start: at(daysAgo(2), 9), stop: at(daysAgo(2), 10) });
  await page.clock.install();
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer.getByLabel('Description')).toHaveValue('Remote timer');
  await expect(page.locator('.entry-list .entry-line')).toHaveCount(2);
  // Days run newest first: "Other history", then "Old history". The typed text replaces the
  // value attribute, so the row is held by position.
  const row = page.locator('.entry-list .entry-line').nth(1);
  const oldId = [...(await device.entries()).values()].find((entry) => entry.description === 'Old history')!.id;

  // Typing in the running timer, not saved yet. The other device renames the entry and tags it.
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

  // Typing in a list row, not saved yet, while the other device edits a different entry.
  const rowDescription = row.getByLabel('Description');
  await rowDescription.fill('Local row draft');
  await device.updateEntry(other.id, { description: 'Other edited again' });
  await page.clock.fastForward(60_000);
  await expect(entryRow(page, 'Other edited again')).toHaveCount(1);
  await expect(rowDescription).toBeFocused();
  await expect(rowDescription).toHaveValue('Local row draft');

  // Committing saves what was typed.
  await rowDescription.press('Enter');
  await expect.poll(async () => (await device.entries()).get(oldId)?.description).toBe('Local row draft');
});

// With similar entries grouped (the default), a row's React key is its description, project, task,
// tags and billable flag. When another device changes any of them on the entry being typed in,
// the refresh remounts the row: focus and the unsaved text are gone, and Enter saves nothing.
test.fixme('TT-0060: a refresh keeps an unsaved row description when another device edits that entry', async ({ page }) => {
  await device.createEntry({ description: 'Old history', start: at(daysAgo(1), 9), stop: at(daysAgo(1), 10) });
  const project = await device.createProject('Acme');
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
  await rowDescription.press('Enter');
  await expect.poll(async () => (await device.entries()).get(id)?.description).toBe('Local row draft');
});
