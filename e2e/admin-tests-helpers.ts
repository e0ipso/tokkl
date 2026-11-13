import { expect, type Locator, type Page } from '@playwright/test';
import { test as base, type InstanceSettings } from './fixtures.ts';
import type { Invite } from '../packages/types/index.ts';

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

export async function openAdmin(
  page: Page,
  section: 'Users' | 'Invites' | 'Instance settings' = 'Users',
): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: section, exact: true })
    .click();
}

export function userRow(page: Page, email: string): Locator {
  return page.locator('#users tbody tr').filter({ hasText: email });
}

export function inviteRow(page: Page, note: string): Locator {
  return page.locator('#invites tbody tr').filter({ hasText: note });
}

/** Serve the sign-up list fields while keeping the real invite ID and revocation request. */
export async function mockSignupInvite(page: Page, id: number, email: string): Promise<void> {
  await page.route('**/api/app/admin/invites', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const invites: Invite[] = await response.json();
    await route.fulfill({
      response,
      json: invites.map(invite => (invite.id === id ? { ...invite, source: 'signup', email } : invite)),
    });
  });
}

/** The error comes first; a stepper card (components/LengthStepper.tsx) lists its range after it. */
export async function describedError(control: Locator): Promise<Locator> {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  await expect
    .poll(
      () =>
        control.evaluate(element => {
          const id = element.getAttribute('aria-describedby')?.split(' ')[0];
          return id ? document.getElementById(id)?.getAttribute('role') : null;
        }),
      { message: 'the control points at its error alert' },
    )
    .toBe('alert');
  const id = (await control.getAttribute('aria-describedby'))?.split(' ')[0];
  expect(id, 'the control points at its error').toBeTruthy();
  return control.page().locator(`[id="${id}"]`);
}
