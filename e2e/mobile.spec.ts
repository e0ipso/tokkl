import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { nextRunning, TimerApi } from './timer-tests-helpers.ts';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('timer page works on a phone-sized screen', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await timer.getByLabel('Description').fill('Phone entry');
  await timer.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Description')).toHaveValue('Phone entry');
  await page.screenshot({ path: 'test-results/mobile-running.png' });
  // A timer stopped seconds after it started goes to the trash, so this one has run a while.
  const api = await TimerApi.open(page);
  await api.backdate((await nextRunning(api, null)).id, 10);
  await timer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(timer.getByRole('button', { name: 'Start timer' })).toBeVisible();
  await expect(page.locator('.entry-line').first().getByLabel('Description')).toHaveValue('Phone entry');

  const box = await page.locator('body').boundingBox();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(Math.ceil(box!.width));
  await page.screenshot({ path: 'test-results/mobile-list.png' });
});
