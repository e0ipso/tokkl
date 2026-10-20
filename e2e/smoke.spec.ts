import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { expectSnapped, instant, nextRunning, TimerApi } from './timer-tests-helpers.ts';

test('start and stop a timer with a new project and tag', async ({ page, data }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Write the PRD');

  await timer.getByRole('button', { name: 'Project' }).click();
  await page.getByPlaceholder('Find or create project…').fill('Tokkl');
  await page.getByRole('button', { name: 'Create project "Tokkl"' }).click();

  await timer.getByRole('button', { name: 'Tags' }).click();
  await page.getByPlaceholder('Find or create tags…').fill('writing');
  await page.getByRole('button', { name: 'Create tag "writing"' }).click();
  await page.keyboard.press('Escape');

  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Write the PRD');
  await expect(page).toHaveTitle(/0:00:0\d · Write the PRD/);
  // A running timer shows a "Running" label, and the nav dot has text, not just colour.
  const timerLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Timer running' });
  await expect(timer.getByText('Running', { exact: true })).toBeVisible();
  await expect(timerLink).toHaveCount(1);
  await page.screenshot({ path: 'test-results/timer-running.png' });
  const running = await nextRunning(api, null);

  // A timer stopped seconds after it started goes to the trash, so this one has run a while.
  const backdated = await api.backdate(running.id, 10);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  // Stopping snaps the entry to the time resolution; until then it kept its exact start, which the
  // title's elapsed time above counts from.
  const [stopped] = await api.entries();
  expect(stopped!.id).toBe(running.id);
  const step = (await data.me()).time_resolution_minutes * 60_000;
  expectSnapped(stopped!, backdated.start, step);
  // Each end moves at most half a step, so ten minutes keep at least one step.
  expect(instant(stopped!.stop) - instant(stopped!.start)).toBeGreaterThanOrEqual(step);
  await expect(timer.getByText('Running', { exact: true })).toHaveCount(0);
  await expect(timerLink).toHaveCount(0);
  const row = page.locator('.entry-line').first();
  await expect(row.getByLabel('Description')).toHaveValue('Write the PRD');
  await expect(row.locator('.project-label')).toContainText('Tokkl');
  await expect(row.locator('.tag-chip')).toHaveText('writing');
});

test('manual entry across midnight, edit and delete with undo', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Night deploy');
  await timer.getByLabel('Start time').fill('23:30');
  await timer.getByLabel('End time').fill('0:45');
  await expect(timer.locator('.manual-duration')).toHaveText('1:15:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 1:15:00')).toBeVisible();

  const row = page.locator('.entry-line', { has: page.locator('input[value="Night deploy"]') });
  await expect(row.locator('.entry-duration')).toHaveValue('1:15:00');

  // The server rounds the edited duration up to the default 5-minute time resolution.
  await row.getByLabel('Duration').fill('1h 58m');
  await row.getByLabel('Duration').press('Enter');
  await expect(row.locator('.entry-duration')).toHaveValue('2:00:00');

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('input[value="Night deploy"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('input[value="Night deploy"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/timer-list.png', fullPage: true });
});

test('keyboard shortcuts start, stop and continue', async ({ page, data }) => {
  // A finished entry from yesterday, 10:00 to 11:15 UTC, gives "c" something to continue
  // without crossing a day boundary in Europe/Madrid.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await data.createEntry({ description: 'Shortcut seed', start: `${day}T10:00:00Z`, stop: `${day}T11:15:00Z` });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Timer mode' }).click();
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('c');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Shortcut seed');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('s');
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
});

test('discard a running timer, then undo', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Started by mistake');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await timer.getByRole('button', { name: 'Discard running entry' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Started by mistake');
  await timer.getByRole('button', { name: 'Stop timer' }).click();
});

test('undoing a discard while another timer runs restores the entry stopped on the grid', async ({ page, data }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Started by mistake');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  // The restore below stops it now; seconds after its start, it would round to zero and stay in the trash.
  const discarded = await api.backdate((await nextRunning(api, null)).id, 10);
  await timer.getByRole('button', { name: 'Discard running entry' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await timer.getByLabel('Description').fill('Started on purpose');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const kept = await nextRunning(api, discarded.id);

  // Only one timer runs, so the restored entry stops now, snapped to the time resolution.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.entry-line', { has: page.locator('input[value="Started by mistake"]') })).toHaveCount(1);
  const all = await api.entries();
  expect(all.filter((entry) => entry.stop === null).map((entry) => entry.id)).toEqual([kept.id]);
  expectSnapped(all.find((entry) => entry.id === discarded.id)!, discarded.start, (await data.me()).time_resolution_minutes * 60_000);
  await expect(timer.getByLabel('Description')).toHaveValue('Started on purpose');
  await timer.getByRole('button', { name: 'Stop timer' }).click();
});

test('a timer stopped seconds after it started goes to the trash, and Undo brings it back', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Started by accident');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(page.getByText('Too short to keep, so the entry went to the trash')).toBeVisible();
  expect(await api.entries()).toEqual([]);
  const [trashed] = await api.trash();
  expect(trashed!.id).toBe(running.id);
  expect(trashed!.stop).toBe(trashed!.start);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.entry-line', { has: page.locator('input[value="Started by accident"]') })).toHaveCount(1);
  expect(await api.trash()).toEqual([]);
});

test('Continue, a favorite and C each replace a running timer', async ({ page, data }) => {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await data.createEntry({ description: 'Earlier work', start: `${day}T10:00:00Z`, stop: `${day}T11:15:00Z` });
  await data.savePreferences({ favorites: [{ description: 'Standup', project_id: null, task_id: null, tags: [], billable: false }] });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  const entries = async () => (await page.request.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'))
    .json() as Promise<Array<{ id: number; description: string; start: string; stop: string | null }>>;
  const trash = async () => (await page.request.get('/api/app/trash'))
    .json() as Promise<Array<{ description: string; start: string; stop: string }>>;
  const step = (await data.me()).time_resolution_minutes * 60_000;
  // Exactly one entry runs and it is `description`. `previous` was replaced seconds after it
  // started, so it rounded to zero and is the newest of `trashed` entries in the trash, with zero
  // length on a grid point.
  const expectReplaced = async (description: string, previous: string, trashed: number) => {
    await expect(timer.getByLabel('Description')).toHaveValue(description);
    await expect.poll(async () => {
      const running = (await entries()).filter((entry) => !entry.stop);
      const gone = await trash();
      return running.length === 1 && running[0]!.description === description && gone.length === trashed
        && gone[0]!.description === previous && gone[0]!.stop === gone[0]!.start && Date.parse(gone[0]!.start) % step === 0;
    }).toBe(true);
  };

  await timer.getByLabel('Description').fill('Running now');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();

  // A double click starts one entry, not two.
  await page.locator('.entry-line', { has: page.locator('input[value="Earlier work"]') })
    .getByRole('button', { name: 'Continue this entry' }).dblclick();
  await expectReplaced('Earlier work', 'Running now', 1);
  expect((await entries()).filter((entry) => entry.description === 'Earlier work')).toHaveLength(2);

  await page.locator('.favorites').getByRole('button', { name: 'Standup' }).click();
  await expectReplaced('Standup', 'Earlier work', 2);

  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('c');
  await expectReplaced('Earlier work', 'Standup', 3);
  // The seed and the running replacement.
  expect(await entries()).toHaveLength(2);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await expect.poll(async () => (await trash()).map((entry) => entry.description))
    .toEqual(['Earlier work', 'Standup', 'Earlier work', 'Running now']);
  expect((await entries()).map((entry) => entry.description)).toEqual(['Earlier work']);
});

test('a manual entry across the autumn clock change moves the date to its stop day', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: /^\/api\/v9\/workspaces\/\d+\/time_entries$/, reason: 'the scenario fakes a failed save' });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Clock change');
  await timer.getByLabel('Date').fill('2025-10-25');
  await timer.getByLabel('Start time').fill('23:00');
  await timer.getByLabel('End time').fill('3:30');
  // 23:00 CEST to 3:30 CET: the repeated hour makes it 5.5 hours.
  await expect(timer.locator('.manual-duration')).toHaveText('5:30:00');

  // A failed save keeps the date and times.
  await page.route(/\/api\/v9\/workspaces\/\d+\/time_entries\?/, (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '"Server unavailable"' })
    : route.continue()), { times: 1 });
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Server unavailable')).toBeVisible();
  await expect(timer.getByLabel('Date')).toHaveValue('2025-10-25');
  await expect(timer.getByLabel('Start time')).toHaveValue('23:00');
  await expect(timer.getByLabel('End time')).toHaveValue('3:30');

  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 5:30:00')).toBeVisible();
  await expect(timer.getByLabel('Date')).toHaveValue('2025-10-26');
  await expect(timer.getByLabel('Start time')).toHaveValue('03:30');
  await expect(timer.getByLabel('End time')).toHaveValue('');
  const [saved] = await (await page.request.get('/api/v9/me/time_entries?start_date=2025-10-25&end_date=2025-10-27')).json();
  expect([saved.start, saved.stop]).toEqual(['2025-10-25T21:00:00+00:00', '2025-10-26T02:30:00+00:00']);
});

test('12-hour manual times keep explicit AM/PM and place bare end hours after the start', async ({ page, data }) => {
  await data.savePreferences({ timeofday_format: 'h:mm A' });
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  const duration = timer.locator('.manual-duration');
  const range = async (day: string, start: string, end: string) => {
    await timer.getByLabel('Date').fill(day);
    await timer.getByLabel('Start time').fill(start);
    await timer.getByLabel('End time').fill(end);
  };

  await range('2025-10-20', '10am', '9am');
  await expect(duration).toHaveText('23:00:00');
  // The night the clocks go back has 25 hours, the night they go forward 23.
  await range('2025-10-25', '10am', '9am');
  await expect(duration).toHaveText('24:00:00');
  await range('2026-03-28', '10am', '9am');
  await expect(duration).toHaveText('22:00:00');
  await range('2025-10-20', '10am', '9');
  await expect(duration).toHaveText('11:00:00');

  await range('2025-10-20', '11pm', '1');
  await expect(duration).toHaveText('2:00:00');
  await timer.getByLabel('Description').fill('Late release');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 2:00:00')).toBeVisible();
  await expect(timer.getByLabel('Date')).toHaveValue('2025-10-21');
  await expect(timer.getByLabel('Start time')).toHaveValue('1:00 AM');
});
