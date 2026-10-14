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
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByLabel('Description').fill('Phone timer');
  await tap(timer.getByRole('button', { name: 'Project' }));
  await expectFits(projectPicker);
  await tap(projectPicker.getByRole('button', { name: 'Website', exact: true }));
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
