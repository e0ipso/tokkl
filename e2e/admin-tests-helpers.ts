import { expect, type Locator, type Page } from '@playwright/test';
import { test as base, type InstanceSettings } from './fixtures.ts';

/** The instance settings belong to the whole e2e server, so each scenario puts them back. */
export const test = base.extend<{ instance: InstanceSettings }>({
  instance: [
    async ({ data }, use) => {
      const saved = await data.instanceSettings();
      try {
        await use(saved);
      } finally {
        await data.saveInstanceSettings(saved);
      }
    },
    { auto: true },
  ],
});

export { expect };

export async function openAdmin(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
}

export function userRow(page: Page, email: string): Locator {
  return page.locator('#users tbody tr').filter({ hasText: email });
}

export function inviteRow(page: Page, note: string): Locator {
  return page.locator('#invites tbody tr').filter({ hasText: note });
}

/** The error comes first; a stepper card (components/LengthStepper.tsx) lists its range after it. */
export async function describedError(control: Locator): Promise<Locator> {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const id = (await control.getAttribute('aria-describedby'))?.split(' ')[0];
  expect(id, 'the control points at its error').toBeTruthy();
  return control.page().locator(`[id="${id}"]`);
}
