import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';

// TT-0110: the colour radiogroup, the date range presets and the project picker each take one Tab
// stop, and arrows, Home and End move through their options. Each scenario drives its widget with
// the keyboard only.

/** Presses Tab until focus lands inside the target, and returns how many presses it took. */
async function tabInto(page: Page, target: Locator, limit = 30): Promise<number> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el.contains(document.activeElement))) return i;
  }
  throw new Error(`Tab did not reach the target within ${limit} presses`);
}

/** Options or radios in the group that Tab can reach. */
function tabStops(group: Locator): Promise<number> {
  return group.evaluate((el) => [...el.querySelectorAll('[role="option"], [role="radio"]')]
    .filter((node) => (node as HTMLElement).tabIndex >= 0).length);
}

test('the colour field is one Tab stop and arrows check swatches without opening the native picker', async ({ page }) => {
  // Count calls to the native colour picker instead of opening it.
  await page.addInitScript(() => {
    const win = window as unknown as { pickerCalls: number };
    win.pickerCalls = 0;
    HTMLInputElement.prototype.showPicker = function showPicker() { win.pickerCalls += 1; };
  });
  await login(page);
  const api = await EntityApi.open(page);
  const project = await api.createProject({ name: 'Palette' });
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit Palette' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit project' });
  const group = editor.getByRole('radiogroup', { name: 'Color' });
  const radios = group.getByRole('radio');
  const custom = group.getByRole('radio', { name: 'Custom' });
  const pickerCalls = () => page.evaluate(() => (window as unknown as { pickerCalls: number }).pickerCalls);

  const count = await radios.count();
  expect(count).toBeGreaterThan(2);
  expect(await tabStops(group)).toBe(1);
  const startIndex = await radios.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-checked') === 'true'));
  expect(startIndex).toBeGreaterThanOrEqual(0);

  // Tab lands on the checked radio.
  await tabInto(page, group);
  await expect(radios.nth(startIndex)).toBeFocused();

  // Home checks the first swatch; ArrowRight and ArrowDown move on and check.
  await page.keyboard.press('Home');
  await expect(radios.nth(0)).toBeFocused();
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toBeFocused();
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect(radios.nth(0)).toBeFocused();
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  expect(await tabStops(group)).toBe(1);

  // ArrowLeft from the first radio wraps to Custom, which takes focus but stays unchecked and
  // leaves the native picker closed. ArrowRight wraps back to the first swatch.
  await page.keyboard.press('ArrowLeft');
  await expect(custom).toBeFocused();
  await expect(custom).toHaveAttribute('aria-checked', 'false');
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(custom).toBeFocused();
  expect(await pickerCalls()).toBe(0);

  // Tab leaves the group in one press, and Shift+Tab comes back to the checked radio.
  await page.keyboard.press('Tab');
  expect(await group.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Shift+Tab');
  await expect(radios.nth(0)).toBeFocused();

  // Space on Custom opens the native picker.
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  expect(await pickerCalls()).toBe(1);

  const chosen = await radios.nth(0).evaluate((el) => (el as HTMLElement).style.background);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const saved = await api.project(project.id);
  expect(await page.evaluate((color) => {
    const probe = document.createElement('span');
    probe.style.background = color;
    return probe.style.background;
  }, saved.color)).toBe(chosen);
});

test('the date range presets are one Tab stop that arrows walk without choosing', async ({ page }) => {
  await login(page);
  await page.goto('/reports');
  const rangeButton = page.locator('.range-button');
  await expect(rangeButton).toBeVisible();
  await tabInto(page, rangeButton, 60);
  await page.keyboard.press('Enter');

  const list = page.getByRole('listbox', { name: 'Date range' });
  const options = list.getByRole('option');
  const count = await options.count();
  const selected = list.getByRole('option', { selected: true });
  await expect(selected).toHaveCount(1);
  const selectedName = (await selected.textContent())?.trim() ?? '';
  const selectedIndex = await options.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-selected') === 'true'));

  // Opening focuses the selected preset, the only Tab stop in the list.
  await expect(options.nth(selectedIndex)).toBeFocused();
  expect(await tabStops(list)).toBe(1);

  // Arrows, Home and End move focus and wrap; the selection stays until Enter.
  await page.keyboard.press('Home');
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(options.nth(count - 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(options.nth(count - 1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(options.nth(count - 2)).toBeFocused();
  await expect(list.getByRole('option', { selected: true })).toHaveText(selectedName);
  expect(await tabStops(list)).toBe(1);

  // Tab leaves the list for the custom range in one press.
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('From', { exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(options.nth(count - 2)).toBeFocused();

  // Enter chooses the focused preset, closes the list and returns focus to the range button.
  const target = (await options.nth(count - 2).textContent())?.trim() ?? '';
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(rangeButton).toContainText(target);
  await expect(rangeButton).toBeFocused();
});

test('the project picker search is a combobox whose arrows move aria-activedescendant and Enter picks', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const alpha = await api.createProject({ name: 'Alpha' });
  await api.createTask(alpha.id, 'Planning');
  await api.createProject({ name: 'Beta' });
  await api.createProject({ name: 'Gamma' });
  await page.reload();

  // '@' in the empty description opens the picker.
  const timer = page.getByRole('region', { name: 'Timer' });
  const description = timer.getByLabel('Description');
  await tabInto(page, description);
  await page.keyboard.press('@');
  const combobox = page.getByRole('combobox', { name: 'Find or create project…' });
  await expect(combobox).toBeFocused();
  const list = page.getByRole('listbox', { name: 'Projects' });
  await expect(combobox).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? 'missing');
  await expect(combobox).not.toHaveAttribute('aria-activedescendant');

  const options = list.getByRole('option');
  // No project, Alpha, Planning, Beta, Gamma.
  await expect(options).toHaveCount(5);
  expect(await tabStops(list)).toBe(0);
  const activeName = async () => {
    const id = await combobox.getAttribute('aria-activedescendant');
    return id ? (await page.locator(`[id="${id}"]`).textContent())?.trim() : null;
  };

  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('No project');
  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('Alpha');
  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('Planning');
  await page.keyboard.press('End');
  expect(await activeName()).toBe('Gamma');
  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('No project');
  await page.keyboard.press('ArrowUp');
  expect(await activeName()).toBe('Gamma');
  await page.keyboard.press('Home');
  expect(await activeName()).toBe('No project');
  await expect(combobox).toBeFocused();

  // Typing clears the active option; Enter then picks the active task.
  await page.keyboard.type('a');
  await expect(combobox).not.toHaveAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('Alpha');
  await page.keyboard.press('ArrowDown');
  expect(await activeName()).toBe('Planning');
  await page.keyboard.press('Enter');
  await expect(combobox).toBeHidden();
  await expect(timer.getByRole('button', { name: 'Project' })).toContainText('Alpha: Planning');
});
