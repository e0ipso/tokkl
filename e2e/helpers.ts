import { expect, type Locator, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, SETUP_CODE, currentAccount, type Account } from './fixtures.ts';

/**
 * Logs in through the form as this worker's account (`currentAccount()`). On a server with no
 * account yet it creates the setup admin instead.
 */
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
    const account = currentAccount();
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
}

/**
 * Logs in through the form as an account that already exists, such as one from the `users`
 * fixture: `await loginAs(page, user.account)`.
 */
export async function loginAs(page: Page, account: Pick<Account, 'email' | 'password'>) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
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

/** The hue token in styles.css that each section, as App.tsx names it in data-section, fills with. */
const SECTION_HUES = { timer: '--hue-orange', reports: '--hue-sky', projects: '--hue-violet', settings: '--hue-yellow', more: '--hue-pink' } as const;

export type Section = keyof typeof SECTION_HUES;

/**
 * `item` marks the open page in the navigation: it is filled with its section's hue and set in
 * bold, and the page's main element carries the same section.
 */
export async function expectSectionHue(page: Page, item: Locator, section: Section): Promise<void> {
  const hue = await page.evaluate((token) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${token})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, SECTION_HUES[section]);
  expect(hue, `${SECTION_HUES[section]} resolves to a colour`).not.toBe('rgba(0, 0, 0, 0)');
  await expect(item).toHaveCSS('background-color', hue);
  await expect(item).toHaveCSS('font-weight', '800');
  await expect(page.getByRole('main')).toHaveAttribute('data-section', section);
}
