import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { expectSnapped, instant, madridWallClock, metadataOf, nextRunning, TimerApi } from './timer-tests-helpers.ts';

// A running entry is edited in place (docs/PRD.md T6): same ID, still running, every field kept.
// A timer forgotten past the 999-hour cap still stops, at the cap.

test('editing a running entry keeps its ID, leaves it running and survives reload', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const design = await api.createProject('Design');
  const wireframes = await api.createTask(design, 'Wireframes');
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Draft');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);

  await timer.getByLabel('Description').fill('Draft the spec');
  await timer.getByLabel('Description').blur();
  await expect.poll(async () => (await api.current())?.description).toBe('Draft the spec');

  await timer.getByRole('button', { name: 'Project' }).click();
  await page.locator('.picker-subitem', { hasText: 'Wireframes' }).click();
  await expect.poll(async () => [(await api.current())?.project_id, (await api.current())?.task_id]).toEqual([design, wireframes]);

  await timer.getByRole('button', { name: 'Tags' }).click();
  await page.getByPlaceholder('Find or create tags…').fill('focus');
  await page.getByRole('button', { name: 'Create tag "focus"' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await api.current())?.tags).toEqual(['focus']);

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

test('closing a picker focuses the description without opening its suggestions', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const design = await api.createProject('Design');
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  const description = timer.getByLabel('Description');
  const suggestions = page.locator('.suggestions');
  await description.fill('Draft the spec');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await nextRunning(api, null);
  await description.blur();
  await expect(suggestions).toHaveCount(0);

  // Records whether the list shows at any point, so a list that opens and then closes again on a
  // stale blur timeout fails as well as one that stays open.
  const watchSuggestions = () => page.evaluate(() => {
    const flag = window as Window & { suggestionsShown?: boolean };
    flag.suggestionsShown = false;
    new MutationObserver(() => {
      if (document.querySelector('.suggestions')) flag.suggestionsShown = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const suggestionsShown = () => page.evaluate(() => (window as Window & { suggestionsShown?: boolean }).suggestionsShown);

  await timer.getByRole('button', { name: 'Project' }).click();
  await watchSuggestions();
  await page.locator('.picker-item', { hasText: 'Design' }).click();
  await expect.poll(async () => (await api.current())?.project_id).toBe(design);
  await expect(description).toBeFocused();
  await expect(suggestions).toHaveCount(0);
  expect(await suggestionsShown()).toBe(false);

  await timer.getByRole('button', { name: 'Tags' }).click();
  await watchSuggestions();
  await page.getByPlaceholder('Find or create tags…').fill('focus');
  await page.getByRole('button', { name: 'Create tag "focus"' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await api.current())?.tags).toEqual(['focus']);
  await expect(description).toBeFocused();
  await expect(suggestions).toHaveCount(0);
  expect(await suggestionsShown()).toBe(false);

  // Typing after a picker closed opens the list again. Retyping the last letter leaves the
  // description as it was, so the blur below has nothing to save.
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await page.keyboard.type('c');
  await expect(description).toHaveValue('Draft the spec');
  await page.keyboard.press('Escape');
  await expect(suggestions).toHaveCount(0);

  // Focusing the field by hand still offers the matching entry.
  await description.blur();
  await description.click();
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await expect(suggestions.getByRole('option')).toContainText('Draft the spec');
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

test('a timer left running past 999 hours stops at the cap instead of failing', async ({ page, data }) => {
  const step = (await data.me()).time_resolution_minutes * 60_000;
  await login(page);
  const api = await TimerApi.open(page);
  const start = new Date(Date.now() - 1000 * 3_600_000).toISOString();
  const forgotten = await api.startTimer({ description: 'Forgotten', start });
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer.getByRole('button', { name: /elapsed, edit start time$/ })).toHaveText(/^1000:00:\d\d$/);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  expect(await api.current()).toBeNull();
  const saved = (await api.entries()).find((entry) => entry.id === forgotten.id)!;
  expectSnapped(saved, start, step);
  expect(instant(saved.stop) - instant(saved.start)).toBe(999 * 3_600_000);
});
