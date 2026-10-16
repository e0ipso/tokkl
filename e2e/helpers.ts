import { expect, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, SETUP_CODE } from './fixtures.ts';

export async function login(page: Page) {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: 'Create the first admin' });
  const loginHeading = page.getByRole('heading', { name: 'Log in' });
  await expect(setup.or(loginHeading)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Setup code').fill(SETUP_CODE);
    await page.getByLabel('Name').fill('E2E User');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create admin account' }).click();
  } else {
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
}

function luminance(color: string): number {
  const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (channels.length < 3) throw new Error(`Cannot parse colour ${color}`);
  const weights = [0.2126, 0.7152, 0.0722];
  return channels.reduce((sum, value, i) => {
    const c = value / 255;
    return sum + (weights[i] ?? 0) * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  }, 0);
}

/** WCAG 2 contrast ratio between two computed rgb() or rgba() colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
