import { expect, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, SETUP_CODE } from './fixtures.ts';

export async function login(page: Page) {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: 'Create your account' });
  const loginHeading = page.getByRole('heading', { name: 'Log in' });
  await expect(setup.or(loginHeading)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Setup code').fill(SETUP_CODE);
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
