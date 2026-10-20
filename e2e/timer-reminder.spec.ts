import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { clickNotification, focusCalls, permissionRequests, setHidden, shownNotifications, stubNotifications } from './notification-tests-helpers.ts';
import { TimerApi } from './timer-tests-helpers.ts';

const HOUR = 3_600_000;
const reminder = (page: Page) => page.getByRole('status', { name: 'Long-running timer reminder' });

async function open(page: Page, permission: NotificationPermission = 'granted') {
  await stubNotifications(page, { permission });
  await page.clock.install();
  await login(page);
  const api = await TimerApi.open(page);
  await api.savePreferences({ long_timer_reminder_hours: 1 });
  const now = await page.evaluate(() => Date.now());
  await api.startTimer({ description: 'Long task', start: new Date(now).toISOString() });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  return api;
}

test('the threshold triggers a reminder on any page and one background notification', async ({ page }) => {
  const api = await open(page);
  const running = await api.current();
  await page.goto('/reports');
  await setHidden(page, true);
  await page.clock.fastForward(HOUR - 30_000);
  await expect(reminder(page)).toHaveCount(0);
  await expect.poll(() => shownNotifications(page)).toHaveLength(0);
  await page.clock.fastForward(31_000);
  await expect(reminder(page)).toContainText('more than 1 hour');
  await expect.poll(() => shownNotifications(page)).toHaveLength(1);
  expect((await shownNotifications(page))[0]?.title).toBe('Is your timer still running on purpose?');
  await page.clock.fastForward(HOUR);
  expect(await shownNotifications(page)).toHaveLength(1);
  expect(await permissionRequests(page)).toBe(0);
  await clickNotification(page, 0);
  expect(await focusCalls(page)).toBe(1);
  expect((await shownNotifications(page))[0]?.closed).toBe(true);
  await page.getByRole('button', { name: 'Keep running' }).click();
  await expect(reminder(page)).toHaveCount(0);
  expect((await api.current())?.id).toBe(running?.id);
  await page.reload();
  await page.clock.fastForward(HOUR);
  await expect(reminder(page)).toHaveCount(0);
  await page.goto('/settings');
  await expect(reminder(page)).toHaveCount(0);
});

test('a visible reminder survives reload, can be reviewed, and resets for another timer', async ({ page }) => {
  const api = await open(page);
  await page.clock.fastForward(HOUR + 1000);
  await expect(reminder(page)).toBeVisible();
  expect(await shownNotifications(page)).toHaveLength(0);
  await page.reload();
  await expect(reminder(page)).toBeVisible();
  await page.goto('/settings');
  await expect(reminder(page)).toBeVisible();
  await page.getByRole('link', { name: 'Review timer' }).click();
  await expect(page.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep running' }).click();
  await api.startTimer({ description: 'Another task', start: new Date(Date.now() - 2 * HOUR).toISOString() });
  await page.reload();
  await expect(reminder(page)).toBeVisible();
  await page.getByRole('button', { name: 'Stop timer' }).click();
  await expect(reminder(page)).toHaveCount(0);
});

test('blocked notifications still show a reminder and confirmation reaches other tabs', async ({ page, context }) => {
  await open(page, 'denied');
  await setHidden(page, true);
  await page.clock.fastForward(HOUR + 1000);
  await expect(reminder(page)).toBeVisible();
  expect(await shownNotifications(page)).toHaveLength(0);
  const other = await context.newPage();
  await other.clock.install({ time: await page.evaluate(() => Date.now()) });
  await other.goto('/reports');
  await expect(reminder(other)).toBeVisible();
  await page.getByRole('button', { name: 'Keep running' }).click();
  await expect(reminder(other)).toHaveCount(0);
  await other.close();
});

test('changing a confirmed timer start time asks for confirmation again', async ({ page }) => {
  const api = await open(page);
  await page.clock.fastForward(HOUR + 1000);
  await page.getByRole('button', { name: 'Keep running' }).click();
  const entry = await api.current();
  expect(entry).not.toBeNull();
  await api.backdate(entry!.id, 120);
  await page.reload();
  await expect(reminder(page)).toBeVisible();
});

test('the threshold and switch save in Preferences and apply to the current timer', async ({ page }) => {
  await open(page);
  await page.goto('/settings');
  const card = page.getByRole('form', { name: 'Preferences' });
  const group = card.getByRole('group', { name: 'Long-running timers' });
  const hours = group.getByLabel('Remind me after (hours)');
  const enabled = group.getByRole('checkbox', { name: 'Remind me to check long-running timers' });
  await hours.fill('2');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Preferences saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(hours).toHaveValue('2');
  await page.clock.fastForward(HOUR + 1000);
  await expect(reminder(page)).toHaveCount(0);
  await page.clock.fastForward(HOUR);
  await expect(reminder(page)).toBeVisible();
  await enabled.uncheck();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.reload();
  await expect(enabled).not.toBeChecked();
  await expect(reminder(page)).toHaveCount(0);
});

test('a reminder works on a phone when browser storage is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('tokkl.longTimerReminder.')) throw new DOMException('Storage blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('tokkl.longTimerReminder.')) throw new DOMException('Storage blocked', 'SecurityError');
      set.call(this, key, value);
    };
  });
  await open(page);
  await setHidden(page, true);
  await page.clock.fastForward(HOUR + 1000);
  await expect(reminder(page)).toBeVisible();
  await page.clock.fastForward(60_000);
  expect(await shownNotifications(page)).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Keep running' }).click();
  await page.clock.fastForward(60_000);
  await expect(reminder(page)).toHaveCount(0);
});
