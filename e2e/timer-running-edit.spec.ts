import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { instant, madridWallClock, metadataOf, nextRunning, TimerApi } from './timer-tests-helpers.ts';

// A running entry is edited in place (docs/PRD.md T6): same ID, still running, every field kept.

test('editing a running entry keeps its ID, leaves it running and survives reload', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const design = await api.createProject('Design');
  const wireframes = await api.createTask(design, 'Wireframes');
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  // Closing a picker focuses the description, and its suggestions then cover the buttons beside it
  // whenever the picker stayed open longer than the description's blur timeout. Close them first.
  const closeSuggestions = async () => {
    await expect(timer.getByLabel('Description')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(timer.getByRole('listbox')).toHaveCount(0);
  };
  await timer.getByLabel('Description').fill('Draft');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);

  await timer.getByLabel('Description').fill('Draft the spec');
  await timer.getByLabel('Description').blur();
  await expect.poll(async () => (await api.current())?.description).toBe('Draft the spec');

  await timer.getByRole('button', { name: 'Project' }).click();
  await page.locator('.picker-subitem', { hasText: 'Wireframes' }).click();
  await expect.poll(async () => [(await api.current())?.project_id, (await api.current())?.task_id]).toEqual([design, wireframes]);

  await closeSuggestions();
  await timer.getByRole('button', { name: 'Tags' }).click();
  await page.getByPlaceholder('Find or create tags…').fill('focus');
  await page.getByRole('button', { name: 'Create tag "focus"' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await api.current())?.tags).toEqual(['focus']);

  await closeSuggestions();
  await timer.getByRole('button', { name: 'Billable' }).click();
  await expect.poll(async () => (await api.current())?.billable).toBe(true);

  // Move the start two hours back through the editor; typed times are whole minutes.
  const start = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 60_000) * 60_000);
  const wall = madridWallClock(start);
  await timer.getByRole('button', { name: /^\d+:\d\d:\d\d elapsed, edit start time$/ }).click();
  const editor = page.getByRole('dialog', { name: 'Edit running entry' });
  await editor.getByLabel('Date').fill(wall.day);
  await editor.getByLabel('Start').fill(wall.time);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => instant((await api.current())?.start ?? null)).toBe(start.getTime());
  await expect(timer.getByRole('button', { name: /^2:0\d:\d\d elapsed, edit start time$/ })).toBeVisible();

  const expected = { description: 'Draft the spec', project_id: design, task_id: wireframes, tags: ['focus'], billable: true };
  const check = async () => {
    const all = await api.entries();
    expect(all.map((entry) => entry.id)).toEqual([running.id]);
    const [entry] = all;
    expect(entry!.stop).toBeNull();
    expect(instant(entry!.start)).toBe(start.getTime());
    expect(metadataOf(entry!)).toEqual(expected);
  };
  await check();

  await page.reload();
  await expect(timer.getByLabel('Description')).toHaveValue('Draft the spec');
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Design: Wireframes');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'focus');
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await check();
});

test('the clock keeps ticking and a refetch keeps what is being typed into the running description', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Focus');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);

  const description = timer.getByLabel('Description');
  const clock = timer.getByRole('button', { name: /^\d+:\d\d:\d\d elapsed, edit start time$/ });
  await description.click();
  await description.press('End');
  await description.pressSequentially(' block');
  const before = await clock.textContent();
  await expect.poll(() => clock.textContent(), { timeout: 5_000 }).not.toBe(before);
  await expect(description).toBeFocused();

  // Another device tags the entry. A focus refetch brings that in without wiping the typing.
  const remote = await page.request.put(`/api/v9/workspaces/${api.workspaceId}/time_entries/${running.id}`, {
    headers: { 'X-Tokkl-CSRF': '1' }, data: { tags: ['remote'] },
  });
  expect(remote.ok()).toBe(true);
  const refetched = page.waitForResponse((response) => response.url().includes('/time_entries/current') && response.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refetched;
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'remote');
  await expect(description).toHaveValue('Focus block');
  await expect(description).toBeFocused();

  await description.pressSequentially(' two');
  await description.blur();
  await expect.poll(async () => (await api.current())?.description).toBe('Focus block two');
  const all = await api.entries();
  expect(all.map((entry) => entry.id)).toEqual([running.id]);
  expect(metadataOf(all[0]!)).toEqual({ description: 'Focus block two', project_id: null, task_id: null, tags: ['remote'], billable: false });
  expect(all[0]!.stop).toBeNull();
});
