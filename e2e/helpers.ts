import { expect, type Page } from '@playwright/test';

const EMAIL = 'e2e@example.com';
const PASSWORD = 'e2e password';

export async function login(page: Page) {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: 'Create your account' });
  const loginHeading = page.getByRole('heading', { name: 'Log in' });
  await expect(setup.or(loginHeading)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Setup code').fill('E2E-SETUP-CODE');
    await page.getByLabel('Name').fill('E2E User');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
  } else {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
}
