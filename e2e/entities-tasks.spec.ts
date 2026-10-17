import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi, entryRow, yesterday } from './entity-tests-helpers.ts';

/** Opens the project editor's task list from the Projects page. */
async function openTasks(page: Page, project: string) {
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: `Edit ${project}` }).click();
  const editor = page.getByRole('dialog', { name: 'Edit project' });
  return { editor, tasks: editor.getByRole('region', { name: 'Tasks' }) };
}

/** Task names the timer's project picker offers, then closes it. */
async function pickerTasks(page: Page): Promise<string[]> {
  await page.getByRole('link', { name: 'Timer' }).click();
  await page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Project' }).click();
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create project…') });
  await expect(picker.getByRole('option', { name: 'No project' })).toBeVisible();
  const names = await picker.locator('.picker-subitem').allTextContents();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  return names.map((name) => name.trim());
}

test('a project task is created, renamed, assigned, completed and deleted without losing its entry', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = yesterday();
  const project = await api.createProject({ name: 'Platform' });
  const entry = await api.createEntry({ description: 'Schema work', start: `${day}T08:00:00Z`, stop: `${day}T09:30:00Z`, project_id: project.id });

  let { editor, tasks } = await openTasks(page, 'Platform');
  await tasks.getByRole('textbox', { name: 'New task name' }).fill('Design');
  await tasks.getByRole('textbox', { name: 'New task name' }).press('Enter');
  await expect(tasks.getByRole('textbox', { name: 'Task name', exact: true })).toHaveValue('Design');
  const [task] = await api.tasks(project.id);
  expect(task).toMatchObject({ name: 'Design', project_id: project.id, active: true });

  await tasks.getByRole('textbox', { name: 'Task name', exact: true }).fill('Design review');
  await tasks.getByRole('textbox', { name: 'Task name', exact: true }).press('Enter');
  await expect.poll(async () => (await api.tasks(project.id)).map((t) => t.name)).toEqual(['Design review']);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  ({ editor, tasks } = await openTasks(page, 'Platform'));
  await expect(tasks.getByRole('textbox', { name: 'Task name', exact: true })).toHaveValue('Design review');
  await editor.getByRole('button', { name: 'Cancel' }).click();

  // Pick the task on the entry from the timer list.
  await page.getByRole('link', { name: 'Timer' }).click();
  const row = entryRow(page, 'Schema work');
  await row.locator('.entry-project').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create project…') });
  await picker.locator('.picker-subitem', { hasText: 'Design review' }).click();
  await expect(row.locator('.project-label')).toContainText('Platform: Design review');
  const assigned = await api.entry(entry.id);
  expect(assigned).toMatchObject({ project_id: project.id, task_id: task!.id, duration: 5400 });
  expect(await pickerTasks(page)).toEqual(['Design review']);

  // The task counts the entry's hour and a half.
  ({ editor, tasks } = await openTasks(page, 'Platform'));
  const taskRow = tasks.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: 'Task name', exact: true }) });
  await expect(taskRow.locator('.task-tracked')).toHaveText('1:30:00');

  await tasks.getByRole('checkbox', { name: 'Design review is done' }).check();
  await expect.poll(async () => (await api.tasks(project.id))[0]?.active).toBe(false);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  // A done task leaves the picker, but the entry keeps it.
  expect(await pickerTasks(page)).toEqual([]);
  expect(await api.entry(entry.id)).toMatchObject({ project_id: project.id, task_id: task!.id });
  await expect(row.locator('.project-label')).toContainText('Platform: Design review');

  ({ editor, tasks } = await openTasks(page, 'Platform'));
  await tasks.getByRole('checkbox', { name: 'Design review is done' }).uncheck();
  await expect.poll(async () => (await api.tasks(project.id))[0]?.active).toBe(true);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  expect(await pickerTasks(page)).toEqual(['Design review']);

  ({ editor, tasks } = await openTasks(page, 'Platform'));
  await tasks.getByRole('button', { name: 'Delete task Design review' }).click();
  await tasks.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Deleted task Design review')).toBeVisible();
  await expect(tasks.getByText('No tasks yet.')).toBeVisible();
  expect(await api.tasks(project.id)).toEqual([]);
  await editor.getByRole('button', { name: 'Cancel' }).click();

  const after = await api.entry(entry.id);
  expect(after).toMatchObject({
    id: entry.id, description: 'Schema work', project_id: project.id, task_id: null, start: assigned.start, stop: assigned.stop, duration: 5400,
  });
  await page.getByRole('link', { name: 'Timer' }).click();
  await expect(row.locator('.project-label')).toHaveText('Platform');
  expect(await pickerTasks(page)).toEqual([]);
});

// The inline confirm replaces the focused "Delete task" button, and a delete takes the whole
// row away, so focus moves within the task list instead of falling to the page body.
test('deleting tasks by keyboard keeps focus in the task list', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const project = await api.createProject({ name: 'Platform' });
  for (const name of ['Alpha', 'Beta', 'Gamma']) await api.createTask(project.id, name);
  const { editor, tasks } = await openTasks(page, 'Platform');
  const deleteTask = (name: string) => tasks.getByRole('button', { name: `Delete task ${name}`, exact: true });
  const keep = tasks.getByRole('button', { name: 'Keep', exact: true });
  const confirm = tasks.getByRole('button', { name: 'Delete', exact: true });
  const deleteByKeyboard = async (name: string) => {
    await deleteTask(name).focus();
    await page.keyboard.press('Enter');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(deleteTask(name)).toHaveCount(0);
  };

  // Keep closes the inline confirm and gives focus back to "Delete task".
  await deleteTask('Beta').focus();
  await page.keyboard.press('Enter');
  await expect(keep).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(keep).toHaveCount(0);
  await expect(deleteTask('Beta')).toBeFocused();

  // A deleted task passes focus to the next task's "Delete task", else the previous one's.
  await deleteByKeyboard('Beta');
  await expect(deleteTask('Gamma')).toBeFocused();
  await deleteByKeyboard('Gamma');
  await expect(deleteTask('Alpha')).toBeFocused();

  // With no task left, focus stays in the Tasks region, on the new task field.
  await deleteByKeyboard('Alpha');
  await expect(tasks.getByText('No tasks yet.')).toBeVisible();
  await expect(tasks.getByRole('textbox', { name: 'New task name' })).toBeFocused();
  await expect(editor).toBeVisible();
  expect(await api.tasks(project.id)).toEqual([]);
});

// An archived project's editor has no new task field, so deleting its last task moves focus
// to the Tasks heading instead.
test('deleting the last task of an archived project moves focus to the Tasks heading', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const project = await api.createProject({ name: 'Legacy' });
  await api.createTask(project.id, 'Wrap up');
  await api.archiveProject(project.id);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Archived' }).click();
  await page.getByRole('button', { name: 'Edit Legacy', exact: true }).click();
  const tasks = page.getByRole('dialog', { name: 'Edit project' }).getByRole('region', { name: 'Tasks' });
  await expect(tasks.getByText('Restore the project to add tasks.')).toBeVisible();
  await expect(tasks.getByRole('textbox', { name: 'New task name' })).toHaveCount(0);

  await tasks.getByRole('button', { name: 'Delete task Wrap up', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(tasks.getByRole('button', { name: 'Keep', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');

  await expect(tasks.getByText('No tasks yet.')).toBeVisible();
  await expect(tasks.getByRole('heading', { level: 3, name: 'Tasks' })).toBeFocused();
  expect(await api.tasks(project.id)).toEqual([]);
});
