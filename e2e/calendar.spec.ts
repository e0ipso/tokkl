import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';

test('calendar view shows entries and creates one by dragging', async ({ page }) => {
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await login(page);
  await page.getByRole('button', { name: 'Calendar' }).click();
  const todayColumn = page.locator('.calendar-column.today');
  await expect(todayColumn).toBeVisible();
  const before = await page.locator('.calendar-block:not(.calendar-ghost)').count();

  const box = (await todayColumn.boundingBox())!;
  const body = page.locator('.calendar-body');
  await body.evaluate((el) => el.scrollTo({ top: 8 * 48 }));
  const bodyBox = (await body.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, bodyBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, bodyBox.y + 80, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
  await page.getByRole('dialog').getByLabel('Description').fill('Planning from calendar');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.calendar-block', { hasText: 'Planning from calendar' })).toBeVisible();
  expect(await page.locator('.calendar-block:not(.calendar-ghost)').count()).toBe(before + 1);
  await page.screenshot({ path: 'test-results/calendar.png' });

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('input[value="Planning from calendar"]')).toBeVisible();
});
