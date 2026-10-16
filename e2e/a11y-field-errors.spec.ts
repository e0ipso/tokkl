import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { contrast, login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';

// Form validation errors appear under the field instead of in a toast. The field gets
// aria-invalid, a danger border and aria-describedby pointing at a role=alert message, and submit
// moves focus to the first invalid field.

/** The first opaque background at or behind an element. */
function backgroundOf(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (!/^rgba\(.*,\s*0\)$/.test(background) && background !== 'transparent') return background;
    }
    return 'rgb(255, 255, 255)';
  });
}

/** Checks the field is marked invalid and linked to an inline alert with exactly `message`. */
async function expectFieldError(page: Page, field: Locator, message: string) {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const id = await field.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  const alert = page.locator(`[id="${id}"]`);
  await expect(alert).toHaveText(message);
  await expect(alert).toHaveRole('alert');
  await expect(alert).toHaveClass(/\bfield-error\b/);
  await expect(page.locator('.toast-error')).toHaveCount(0);
  return alert;
}

async function expectValid(field: Locator) {
  await expect(field).not.toHaveAttribute('aria-invalid');
  await expect(field).not.toHaveAttribute('aria-describedby');
}

for (const scheme of ['light', 'dark'] as const) {
  test(`manual entry marks the time field to fix, with readable contrast in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await login(page);
    const timer = page.getByRole('region', { name: 'Timer' });
    await timer.getByRole('button', { name: 'Manual mode' }).click();
    await expect(timer.getByLabel('Date')).toBeVisible();
    const start = timer.getByLabel('Start time');
    const end = timer.getByLabel('End time');
    const message = 'Enter a start and end time, like 9:00 and 10:30';

    await start.fill('soon');
    await end.fill('10:30');
    await timer.getByRole('button', { name: 'Add entry' }).click();
    const alert = await expectFieldError(page, start, message);
    await expect(start).toBeFocused();
    await expectValid(end);

    // The border is the danger colour at 3:1 against the field, and the message is 4.5:1 text.
    const danger = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--danger)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(start).toHaveCSS('border-top-color', danger);
    expect(contrast(danger, await backgroundOf(start))).toBeGreaterThanOrEqual(3);
    expect(contrast(danger, await backgroundOf(timer))).toBeGreaterThanOrEqual(3);
    await expect(alert).toHaveCSS('color', danger);
    expect(contrast(danger, await backgroundOf(alert))).toBeGreaterThanOrEqual(4.5);

    // Typing clears the error; a readable start with an unreadable end marks the end instead.
    await start.fill('9:00');
    await expectValid(start);
    await expect(alert).toHaveCount(0);
    await end.fill('later');
    await end.press('Enter');
    await expectFieldError(page, end, message);
    await expect(end).toBeFocused();
    await expectValid(start);
  });
}

test('the entry editor shows time, duration and split errors on their fields', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await api.createEntry({ description: 'Inline errors', start: `${day}T09:00:00Z`, stop: `${day}T10:00:00Z` });
  await page.reload();

  const row = page.locator('.entry-line', { has: page.locator('input[value="Inline errors"]') });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  const start = editor.getByLabel('Start', { exact: true });
  const duration = editor.getByLabel('Duration');
  const split = editor.getByLabel('Split at');

  await start.fill('nope');
  await duration.fill('forever');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expectFieldError(page, start, 'Check the start and end times');
  await expectFieldError(page, duration, 'Check the duration');
  await expect(start).toBeFocused();
  await expect(editor).toBeVisible();

  await split.fill('whenever');
  await editor.getByRole('button', { name: 'Split' }).click();
  await expectFieldError(page, split, 'Enter a split time like 10:30');
  await expect(split).toBeFocused();
  await split.fill('23:59');
  await editor.getByRole('button', { name: 'Split' }).click();
  await expectFieldError(page, split, 'The split time must fall inside the entry');
  // The save errors are still there: the split check leaves other fields alone.
  await expectFieldError(page, duration, 'Check the duration');
});

test('the project editor marks every invalid field and focuses the first', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const editor = page.getByRole('dialog', { name: 'New project' });
  const name = editor.getByLabel('Name', { exact: true });
  const rate = editor.getByLabel('Hourly rate');
  const currency = editor.getByLabel('Currency');
  const estimate = editor.getByLabel('Estimated hours');

  await rate.fill('lots');
  await currency.fill('EU');
  await estimate.fill('-2');
  await editor.getByRole('button', { name: 'Create project' }).click();
  await expectFieldError(page, name, 'Enter a project name');
  await expectFieldError(page, rate, 'Hourly rate must be a number of 0 or more');
  await expectFieldError(page, currency, 'Currency must be a 3-letter code, like EUR');
  await expectFieldError(page, estimate, 'Estimated hours must be a number of 0 or more');
  await expect(name).toBeFocused();

  // Fixing the name moves focus to the next field to fix on the next submit.
  await name.fill('Apollo');
  await editor.getByRole('button', { name: 'Create project' }).click();
  await expectValid(name);
  await expect(rate).toBeFocused();

  await editor.getByLabel('Client').selectOption({ label: 'Create client…' });
  const clientName = editor.getByLabel('New client name');
  await editor.getByRole('button', { name: 'Add client' }).click();
  await expectFieldError(page, clientName, 'Enter a client name');
  await expect(clientName).toBeFocused();
});

test('client, tag and task names are checked inline', async ({ page }) => {
  await login(page);
  const api = await EntityApi.open(page);
  await api.createProject({ name: 'Hermes' });

  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'New client' }).first().click();
  const clientEditor = page.getByRole('dialog', { name: 'New client' });
  await clientEditor.getByRole('button', { name: 'Create client' }).click();
  const clientName = clientEditor.getByLabel('Name', { exact: true });
  await expectFieldError(page, clientName, 'Enter a client name');
  await expect(clientName).toBeFocused();
  await clientEditor.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Tags' }).click();
  const tagName = page.getByLabel('New tag name');
  await tagName.fill('   ');
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expectFieldError(page, tagName, 'Enter a tag name');
  await expect(tagName).toBeFocused();

  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit Hermes' }).click();
  const tasks = page.getByRole('dialog', { name: 'Edit project' }).getByRole('region', { name: 'Tasks' });
  const taskName = tasks.getByLabel('New task name');
  await tasks.getByRole('button', { name: 'Add task' }).click();
  await expectFieldError(page, taskName, 'Enter a task name');
  await expect(taskName).toBeFocused();
});

test('the settings forms show password, workspace and profile errors inline', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  const password = page.locator('#password');
  const current = password.getByLabel('Current password');
  const next = password.getByLabel('New password', { exact: true });
  const repeat = password.getByLabel('Repeat new password');
  await next.fill('short');
  await password.getByRole('button', { name: 'Change password' }).click();
  await expectFieldError(page, current, 'Enter your current password');
  await expectFieldError(page, next, 'The new password needs at least 8 characters');
  await expectValid(repeat);
  await expect(current).toBeFocused();
  await current.fill('whatever it was');
  await next.fill('long enough now');
  await repeat.fill('something else');
  await password.getByRole('button', { name: 'Change password' }).click();
  await expectFieldError(page, repeat, "The new passwords don't match");
  await expectValid(current);
  await expectValid(next);
  await expect(repeat).toBeFocused();

  const workspace = page.locator('#workspace');
  const currency = workspace.getByLabel('Default currency');
  await currency.fill('E');
  await workspace.getByLabel('Default hourly rate').fill('much');
  await workspace.getByRole('button', { name: 'Save' }).click();
  await expectFieldError(page, currency, 'Currency must be a 3-letter code, like EUR');
  await expectFieldError(page, workspace.getByLabel('Default hourly rate'), 'Hourly rate must be a number of 0 or more');
  await expect(currency).toBeFocused();

  const profile = page.locator('#profile');
  const email = profile.getByLabel('Email');
  await email.fill('not an address');
  await profile.getByRole('button', { name: 'Save' }).click();
  await expectFieldError(page, email, 'Enter a valid email address');
  await expect(email).toBeFocused();
});
