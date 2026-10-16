import { expect, type Locator, type Page } from '@playwright/test';
import { test as base, type InstanceSettings } from './fixtures.ts';

/**
 * Saves the instance settings before each admin scenario and puts them back after it, because they
 * belong to the whole e2e server rather than to one account's workspace.
 */
export const test = base.extend<{ instance: InstanceSettings }>({
  instance: [async ({ data }, use) => {
    const saved = await data.instanceSettings();
    try {
      await use(saved);
    } finally {
      await data.saveInstanceSettings(saved);
    }
  }, { auto: true }],
});

export { expect };

/** Opens the admin page through the main navigation on a desktop. */
export async function openAdmin(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
}

/** The row of one account in the users table. */
export function userRow(page: Page, email: string): Locator {
  return page.locator('#users tbody tr').filter({ hasText: email });
}

/** The row of one pending invite, found by its note. */
export function inviteRow(page: Page, note: string): Locator {
  return page.locator('#invites tbody tr').filter({ hasText: note });
}

/** The inline error a control points at through aria-describedby. */
export async function describedError(control: Locator): Promise<Locator> {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const id = await control.getAttribute('aria-describedby');
  expect(id, 'the control points at its error').toBeTruthy();
  return control.page().locator(`[id="${id}"]`);
}
