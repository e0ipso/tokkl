import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { TimerApi } from './timer-tests-helpers.ts';
import { accountTime, recentDate } from './transfer-tests-helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, tap, tapOutside } from './mobile-tests-helpers.ts';

test.use(PHONE);

test('pickers and the entry editor finish by touch on a phone and save what the desktop saves', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const day = recentDate();
  const project = await api.createProject('Website');
  const task = await api.createTask(project, 'Design');
  const seeded = await api.createEntry({ description: 'Phone edit', start: accountTime(day, '10:00:00'), stop: accountTime(day, '11:00:00') });
  await page.reload();

  const row = page.locator('.entry-line', { has: page.locator('input[value="Phone edit"]') });
  await expect(row).toBeVisible();
  await expectNoPageOverflow(page);
  // The idle timer bar and each of its controls fit the phone screen.
  const timer = page.getByRole('region', { name: 'Timer' });
  await expectFits(timer);
  const controls = timer.locator('input, button').filter({ visible: true });
  expect(await controls.count()).toBeGreaterThanOrEqual(7);
  for (const control of await controls.all()) await expectFits(control);

  // Project and task from the row's picker.
  await tap(row.locator('.entry-project'));
  const projectPicker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create project…') });
  await expectFits(projectPicker);
  await tap(projectPicker.locator('.picker-subitem', { hasText: 'Design' }));
  await expect(projectPicker).toBeHidden();
  await expect(row.locator('.project-label')).toContainText('Website: Design');

  // A new tag from the row's tag picker, closed with a tap outside.
  await tap(row.locator('.entry-tags'));
  const tagPicker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create tags…') });
  await expectFits(tagPicker);
  await tagPicker.getByPlaceholder('Find or create tags…').fill('mobile');
  await tap(tagPicker.getByRole('button', { name: 'Create tag "mobile"' }));
  await expect(tagPicker.getByRole('checkbox', { name: 'mobile' })).toBeChecked();
  await tapOutside(page.locator('.day-header h3').first());
  await expect(tagPicker).toBeHidden();
  await expect(row.locator('.tag-chip')).toHaveText('mobile');

  // Times are hidden in the phone row, so the editor is the way to change them.
  await tap(row.getByRole('button', { name: 'More actions' }));
  await tap(page.getByRole('button', { name: 'Edit', exact: true }));
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  await expectFits(editor);
  await expectNoPageOverflow(page);
  await editor.getByLabel('Description').fill('Phone edit, saved');
  await editor.getByLabel('End').fill('11:45');
  await editor.getByLabel('Description').focus();
  await expect(editor.getByLabel('Duration')).toHaveValue('1:45:00');
  await tap(editor.getByLabel('Billable'));
  await tap(editor.getByRole('button', { name: 'Save' }));
  await expect(editor).toBeHidden();

  const saved = (await api.entries()).find((entry) => entry.id === seeded.id);
  expect(saved).toEqual({
    id: seeded.id, description: 'Phone edit, saved', start: accountTime(day, '10:00:00'), stop: accountTime(day, '11:45:00'),
    project_id: project, task_id: task, tags: ['mobile'], billable: true,
  });
  const savedRow = page.locator('.entry-line', { has: page.locator('input[value="Phone edit, saved"]') });
  await expect(savedRow.locator('.entry-duration')).toHaveValue('1:45:00');

  // The timer bar's picker, then start and stop.
  await timer.getByLabel('Description').fill('Phone timer');
  await tap(timer.getByRole('button', { name: 'Project' }));
  await expectFits(projectPicker);
  await tap(projectPicker.getByRole('option', { name: 'Website', exact: true }));
  await tap(timer.getByRole('button', { name: 'Start timer' }));
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect.poll(async () => (await api.current())?.description).toBe('Phone timer');
  await tap(timer.getByRole('button', { name: 'Stop timer' }));
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  const started = (await api.entries()).find((entry) => entry.description === 'Phone timer');
  expect(started).toMatchObject({ project_id: project, task_id: null, tags: [] });
  expect(started!.stop).not.toBeNull();
  await expectNoPageOverflow(page);
});

// A phone shows one day, today, under a strip of the week's seven days, so long names truncate
// inside the day's column and the strip keeps all seven days on screen.
test('the day calendar fits a phone screen with long block and favourite names', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  await login(page);
  const api = await TimerApi.open(page);
  const project = await api.createProject('Customer onboarding programme');
  const description = 'Quarterly planning workshop with the whole team';
  // Madrid, Wednesday 2026-06-17: 09:00-10:00 and 12:00-12:30 CEST.
  await api.createEntry({ description, project_id: project, start: '2026-06-17T07:00:00Z', stop: '2026-06-17T08:00:00Z' });
  await api.createEntry({ description, project_id: project, start: '2026-06-17T10:00:00Z', stop: '2026-06-17T10:30:00Z' });
  await api.savePreferences({ favorites: [{ description, project_id: project, task_id: null, tags: [], billable: false }] });
  await page.reload();

  await expectFits(page.locator('.favorite').first());
  await tap(page.getByRole('button', { name: 'Calendar' }));
  await expect(page.locator('.calendar-column.today')).toBeVisible();
  await expect(page.locator('.calendar-column')).toHaveCount(1);
  await expectNoPageOverflow(page);
  // The toolbar, the strip and the scrolling calendar body fit the screen. scrollIntoViewIfNeeded
  // stops about a pixel short of the body's bottom edge, so centre the body first.
  await expectFits(page.locator('.calendar-toolbar'));
  const strip = page.getByRole('group', { name: 'Days of the week' });
  await expectFits(strip);
  await expectFits(strip.getByRole('button').last());
  const body = page.locator('.calendar-body');
  await body.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expectFits(body);
  const blocks = page.locator('.calendar-column.today').getByRole('group', { name: `${description}, Customer onboarding programme` });
  await expect(blocks).toHaveCount(2);
  for (const block of await blocks.all()) {
    await expect(block).toBeVisible();
    await expectFits(block);
  }
});

// On a phone the bulk bar sticks to the top of the screen, with its count, while the
// selected list scrolls under it; the timer bar scrolls away instead of covering it.
test('the bulk bar and its count stay on screen while a long selection scrolls', async ({ page }) => {
  await login(page);
  const api = await TimerApi.open(page);
  const day = recentDate();
  for (let hour = 8; hour < 20; hour++) {
    const time = `${String(hour).padStart(2, '0')}:00:00`;
    const end = `${String(hour).padStart(2, '0')}:45:00`;
    await api.createEntry({ description: `Phone entry ${hour}`, start: accountTime(day, time), stop: accountTime(day, end) });
  }
  await page.reload();

  const group = page.locator('.day-group', { has: page.locator('input[value="Phone entry 8"]') });
  await tap(group.locator('.day-select input'));
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  const count = bar.getByText('12 selected');
  await expect(count).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect.poll(async () => (await bar.boundingBox())?.y).toBeCloseTo(0, 0);
  await expectFits(count);
  const timer = await page.getByRole('region', { name: 'Timer' }).boundingBox();
  expect(timer!.y + timer!.height, 'the timer bar scrolled away').toBeLessThanOrEqual(0);
  await expectNoPageOverflow(page);
});
