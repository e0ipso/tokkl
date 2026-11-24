import { describedError } from './admin-tests-helpers.ts';
import { expect, test } from './fixtures.ts';
import { loginAs } from './helpers.ts';
import { TimerApi, instant } from './timer-tests-helpers.ts';

// Every scenario signs in as an account of its own. The resolution is a preference of each account.

test('a resolution saved in Preferences snaps the next entry without a reload, and other accounts keep theirs', async ({
  page,
  data,
  users,
  runtimeErrors,
}) => {
  runtimeErrors.allowResponse({
    status: 400,
    method: 'POST',
    path: /^\/api\/v9\/me\/preferences$/,
    reason: 'a time resolution of 7 minutes does not divide an hour',
  });
  const rita = await users.create();
  await loginAs(page, rita.account);
  await page.goto('/settings/preferences');
  const card = page.getByRole('form', { name: 'Preferences' });
  const resolution = card.getByRole('group', { name: 'Time entries' }).getByLabel('Time resolution (minutes)');
  await expect(resolution).toHaveValue('5');

  await resolution.fill('7');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(await describedError(resolution)).toHaveText(
    'Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60',
  );
  expect(await rita.timeResolution()).toBe(5);

  await resolution.fill('15');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  expect(await rita.timeResolution()).toBe(15);
  expect(await data.timeResolution()).toBe(5);

  // In-app navigation, so the timer uses the preference the save left in the client.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Timer', exact: true }).click();
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Manual mode' }).click();
  await timer.getByLabel('Description').fill('Quarter hour');
  await timer.getByLabel('Date').fill('2025-11-12');
  await timer.getByLabel('Start time').fill('9:02');
  // 9:11 is nearer 9:15 than 9:00; at 5 minutes the span would snap to 9:00 to 9:10.
  await timer.getByLabel('End time').fill('9:11');
  await expect(timer.locator('.manual-duration')).toHaveText('0:15:00');
  await timer.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('Added 0:15:00')).toBeVisible();

  const [saved] = await (await TimerApi.open(page)).entries();
  expect(saved!.description).toBe('Quarter hour');
  // 9:00 to 9:15 in Madrid (CET, UTC+1).
  expect([instant(saved!.start), instant(saved!.stop)]).toEqual([
    Date.parse('2025-11-12T08:00:00Z'),
    Date.parse('2025-11-12T08:15:00Z'),
  ]);
});
