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

test('Continue and a favorite copy every field and stop the replaced timer at the new start', async ({ page }) => {
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

  await page.locator('.entry-line', { has: page.locator('input[value="Design review"]') }).first()
    .getByRole('button', { name: 'Continue this entry' }).click();
  const continued = await nextRunning(api, plain.id);
  expect(continued.id).not.toBe(seed.id);
  expect(metadataOf(continued)).toEqual(metadataOf(review));
  await expect(timer.getByLabel('Description')).toHaveValue('Design review');

  await page.locator('.favorites').getByRole('button', { name: 'Standup' }).click();
  const favorite = await nextRunning(api, continued.id);
  expect(metadataOf(favorite)).toEqual(metadataOf(standup));
  await expect(timer.getByRole('button', { name: 'Billable' })).toHaveAttribute('aria-pressed', 'false');

  const all = await api.entries();
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  expect(all.filter((entry) => entry.stop === null).map((entry) => entry.id)).toEqual([favorite.id]);
  expect(instant(byId.get(plain.id)!.stop)).toBe(instant(continued.start));
  expect(instant(byId.get(continued.id)!.stop)).toBe(instant(favorite.start));
  // Replacing never rewrites the stopped entries' metadata.
  expect(metadataOf(byId.get(plain.id)!)).toEqual(metadataOf(plain));
  expect(metadataOf(byId.get(continued.id)!)).toEqual(metadataOf(review));
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
  const pinned = page.locator('.favorites').getByRole('button', { name: 'Design review' });
  await expect(pinned).toBeVisible();
  const [saved] = (await api.preferences()).favorites as Metadata[];
  expect(metadataOf(saved!)).toEqual(metadataOf(review));

  await pinned.click();
  const running = await nextRunning(api, null);
  expect(metadataOf(running)).toEqual(metadataOf(review));
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Design: Wireframes');
});
