import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { instant, metadataOf, nextRunning, TimerApi, type Metadata } from './timer-tests-helpers.ts';

// Autocomplete, Continue and favorites must copy every field into a new running entry
// (docs/PRD.md T4, T5, T11), and a replacement stops the old timer at the new start (T2).

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** Two projects with a task each; the entries below are billable on a non-billable project and vice versa. */
async function seedMetadata(api: TimerApi): Promise<{ review: Metadata; standup: Metadata }> {
  const design = await api.createProject('Design');
  const wireframes = await api.createTask(design, 'Wireframes');
  const ops = await api.createProject('Operations', true);
  const oncall = await api.createTask(ops, 'On call');
  return {
    review: { description: 'Design review', project_id: design, task_id: wireframes, tags: ['alpha', 'beta'], billable: true },
    standup: { description: 'Standup', project_id: ops, task_id: oncall, tags: ['gamma'], billable: false },
  };
}

test('autocomplete copies project, task, tags and billable into a new running entry', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { review } = await seedMetadata(api);
  const seed = await api.createEntry({ ...review, start: `${yesterday()}T09:00:00Z`, stop: `${yesterday()}T10:00:00Z` });
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Design');
  await expect(page.locator('.suggestions').getByRole('button', { name: /Design review/ })).toBeVisible();
  // The suggestion the arrows reach is selected and has a 3px bar as well as the tint.
  await timer.getByLabel('Description').press('ArrowDown');
  const highlighted = page.locator('.suggestions').getByRole('option', { selected: true });
  await expect(highlighted).toContainText('Design review');
  expect(await highlighted.locator('.suggestion').evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(/ 3px 0px 0px 0px inset$/);
  await page.locator('.suggestions').getByRole('button', { name: /Design review/ }).click();
  await expect(timer.getByLabel('Description')).toHaveValue('Design review');
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Design: Wireframes');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'alpha, beta');
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'true');

  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);
  expect(running.id).not.toBe(seed.id);
  expect(running.stop).toBeNull();
  expect(metadataOf(running)).toEqual(metadataOf(review));
  // The suggestion's source entry is untouched.
  expect((await api.entries()).find((entry) => entry.id === seed.id)).toEqual(seed);
});

test('Continue and a favorite copy every field and stop the replaced timer at the new start', async ({ page, data }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { review, standup } = await seedMetadata(api);
  const seed = await api.createEntry({ ...review, start: `${yesterday()}T09:00:00Z`, stop: `${yesterday()}T10:00:00Z` });
  await api.savePreferences({ favorites: [standup] });
  await page.reload();

  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Plain timer');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  const plain = await nextRunning(api, null);
  expect(metadataOf(plain)).toEqual({ description: 'Plain timer', project_id: null, task_id: null, tags: [], billable: false });
  // The plain timer has run a while, so replacing it keeps it. The continued one is replaced
  // seconds after it started, so it rounds to zero and goes to the trash.
  await api.backdate(plain.id, 10);

  await page.locator('.entry-line', { has: page.locator('input[value="Design review"]') }).first()
    .getByRole('button', { name: 'Continue this entry' }).click();
  const continued = await nextRunning(api, plain.id);
  expect(continued.id).not.toBe(seed.id);
  expect(metadataOf(continued)).toEqual(metadataOf(review));
  await expect(timer.getByLabel('Description')).toHaveValue('Design review');

  // The chip shows the project after the description and is named by both.
  const chip = page.locator('.favorites').getByRole('button', { name: 'Standup, Operations', exact: true });
  await expect(chip.locator('.favorite-project')).toHaveText('Operations');
  await chip.click();
  const favorite = await nextRunning(api, continued.id);
  expect(metadataOf(favorite)).toEqual(metadataOf(standup));
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'false');

  const all = await api.entries();
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  expect(all.filter((entry) => entry.stop === null).map((entry) => entry.id)).toEqual([favorite.id]);
  // A replaced timer stops on the grid point nearest the new start.
  const step = (await data.me()).time_resolution_minutes * 60_000;
  const saved = byId.get(plain.id)!;
  expect(instant(saved.stop) % step).toBe(0);
  expect(Math.abs(instant(saved.stop) - instant(continued.start))).toBeLessThanOrEqual(step / 2);
  const [trashed] = await api.trash();
  expect(trashed!.id).toBe(continued.id);
  expect(trashed!.stop).toBe(trashed!.start);
  expect(byId.has(continued.id)).toBe(false);
  // Replacing never rewrites the stopped entries' metadata.
  expect(metadataOf(saved)).toEqual(metadataOf(plain));
  expect(metadataOf(trashed!)).toEqual(metadataOf(review));
  expect(byId.get(seed.id)).toEqual(seed);
});

test('a favorite pinned from an entry keeps its metadata after reload and starts with it', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const { review } = await seedMetadata(api);
  await api.createEntry({ ...review, start: `${yesterday()}T09:00:00Z`, stop: `${yesterday()}T10:00:00Z` });
  await page.reload();

  await page.locator('.entry-line', { has: page.locator('input[value="Design review"]') })
    .getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Pin as favorite' }).click();
  await expect(page.getByText('Pinned to favorites')).toBeVisible();
  await expect.poll(async () => (await api.preferences()).favorites).toHaveLength(1);

  await page.reload();
  const pinned = page.locator('.favorites').getByRole('button', { name: 'Design review, Design', exact: true });
  await expect(pinned).toBeVisible();
  const [saved] = (await api.preferences()).favorites as Metadata[];
  expect(metadataOf(saved!)).toEqual(metadataOf(review));

  await pinned.click();
  const running = await nextRunning(api, null);
  expect(metadataOf(running)).toEqual(metadataOf(review));
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Design: Wireframes');
});

test('the idle bar edits its draft without writing an entry, and Start takes every edit', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const ops = await api.createProject('Operations', true);
  const oncall = await api.createTask(ops, 'On call');
  await page.reload();

  // Entry reads (the list and the current-entry poll) are fine; any write before Start is not.
  const entryWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/time_entries\b/.test(new URL(request.url()).pathname)) {
      entryWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  const timer = page.getByRole('region', { name: 'Timer' });
  const billable = timer.getByRole('button', { name: 'Billable' });
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await expect(billable).toHaveAttribute('aria-pressed', 'false');

  await timer.getByLabel('Description').fill('Pager handover');
  await timer.getByLabel('Description').blur();
  await expect(timer.getByLabel('Description')).toHaveValue('Pager handover');

  // Picking a task on a billable project turns billable on in the draft.
  await timer.getByRole('button', { name: 'Project' }).click();
  await page.locator('.picker-subitem', { hasText: 'On call' }).click();
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Operations: On call');
  await expect(billable).toHaveAttribute('aria-pressed', 'true');

  await timer.getByRole('button', { name: 'Tags' }).click();
  await page.getByPlaceholder('Find or create tags…').fill('handover');
  await page.getByRole('button', { name: 'Create tag "handover"' }).click();
  await page.keyboard.press('Escape');
  await expect(timer.getByRole('button', { name: 'Tags' })).toHaveAttribute('title', 'handover');

  await billable.click();
  await expect(billable).toHaveAttribute('aria-pressed', 'false');

  // Still idle: nothing is running and no entry was created or patched.
  await expect(timer).not.toHaveClass(/is-running/);
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  expect(await api.current()).toBeNull();
  expect(await api.entries()).toEqual([]);
  expect(entryWrites).toEqual([]);

  await timer.getByRole('button', { name: 'Start timer' }).click();
  const running = await nextRunning(api, null);
  expect(metadataOf(running)).toEqual({ description: 'Pager handover', project_id: ops, task_id: oncall, tags: ['handover'], billable: false });
  expect(entryWrites).toEqual([`POST /api/v9/workspaces/${api.workspaceId}/time_entries`]);
});
