import type { Page } from '@playwright/test';
import { describedError } from './admin-tests-helpers.ts';
import { expect, test, type ExtraUsers } from './fixtures.ts';
import { loginAs } from './helpers.ts';
import { PHONE, expectFits, expectNoPageOverflow, tap } from './mobile-tests-helpers.ts';

// The Pomodoro group of the Preferences card on /settings edits the six pomodoro_* preferences.
// The worker accounts' preferences outlive a scenario, so every scenario signs in as its own account.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const PREFERENCES_PATH = /^\/api\/v9\/me\/preferences$/;

const DEFAULTS = {
  pomodoro_enabled: false,
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  pomodoro_long_break_interval_in_minutes: 15,
  pomodoro_long_break_every: 4,
  pomodoro_stop_timer_at_end: true,
};

/** The group's controls, found by the labels a user reads. */
function group(page: Page) {
  const card = page.getByRole('form', { name: 'Preferences' });
  const pomodoro = card.getByRole('group', { name: 'Pomodoro' });
  return {
    card,
    pomodoro,
    save: card.getByRole('button', { name: 'Save' }),
    enabled: pomodoro.getByRole('checkbox', { name: 'Enable the Pomodoro cycle' }),
    work: pomodoro.getByLabel('Work phase (minutes)'),
    shortBreak: pomodoro.getByLabel('Short break (minutes)'),
    longBreak: pomodoro.getByLabel('Long break (minutes)'),
    every: pomodoro.getByLabel('Long break every (work phases)'),
    stopAtEnd: pomodoro.getByRole('checkbox', { name: 'Stop the timer at the end of a work phase' }),
  };
}

/** The six stored Pomodoro preferences, read from the API. */
async function stored(page: Page): Promise<typeof DEFAULTS> {
  const response = await page.request.get('/api/v9/me/preferences');
  expect(response.ok()).toBe(true);
  const prefs = await response.json() as Record<string, unknown>;
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, prefs[key]])) as typeof DEFAULTS;
}

/** Changes the stored preferences the way another device would. */
async function saveFromAnotherDevice(page: Page, changes: Partial<typeof DEFAULTS>): Promise<void> {
  const response = await page.request.post('/api/v9/me/preferences', { headers: CSRF, data: changes });
  expect(response.ok()).toBe(true);
}

/** Signs in as a new account and opens Settings. */
async function openSettings(page: Page, users: ExtraUsers) {
  const user = await users.create();
  await loginAs(page, user.account);
  await page.goto('/settings');
  await expect(group(page).pomodoro).toBeVisible();
  return group(page);
}

test('the Pomodoro group shows the defaults, and a saved edit sends only its fields and survives a reload', async ({ page, users }) => {
  const form = await openSettings(page, users);
  await expect(form.enabled).not.toBeChecked();
  await expect(form.work).toHaveValue('25');
  await expect(form.shortBreak).toHaveValue('5');
  await expect(form.longBreak).toHaveValue('15');
  await expect(form.every).toHaveValue('4');
  await expect(form.stopAtEnd).toBeChecked();
  expect(await stored(page)).toEqual(DEFAULTS);

  await form.enabled.check();
  await form.work.fill('50');
  await form.shortBreak.fill('10');
  await form.longBreak.fill('20');
  await form.every.fill('3');
  await form.stopAtEnd.uncheck();
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && PREFERENCES_PATH.test(new URL(candidate.url()).pathname));
  await form.save.click();
  await expect(page.getByText('Preferences saved')).toBeVisible();

  const edited = {
    pomodoro_enabled: true,
    pomodoro_focus_interval_in_minutes: 50,
    pomodoro_break_interval_in_minutes: 10,
    pomodoro_long_break_interval_in_minutes: 20,
    pomodoro_long_break_every: 3,
    pomodoro_stop_timer_at_end: false,
  };
  expect((await request).postDataJSON()).toEqual(edited);
  expect(await stored(page)).toEqual(edited);

  await page.reload();
  await expect(form.pomodoro).toBeVisible();
  await expect(form.enabled).toBeChecked();
  await expect(form.work).toHaveValue('50');
  await expect(form.shortBreak).toHaveValue('10');
  await expect(form.longBreak).toHaveValue('20');
  await expect(form.every).toHaveValue('3');
  await expect(form.stopAtEnd).not.toBeChecked();
});

test('a value the server refuses shows its message on the field it names, and nothing is saved', async ({ page, users, runtimeErrors }) => {
  const form = await openSettings(page, users);
  runtimeErrors.allowResponse({
    status: 400, method: 'POST', path: PREFERENCES_PATH, reason: 'a Pomodoro value is out of range',
  });

  await form.work.fill('90');
  await form.every.fill('13');
  await form.save.click();
  await expect(await describedError(form.every)).toHaveText('Invalid pomodoro_long_break_every: expected an integer from 1 to 12');
  await expect(form.every).toBeFocused();
  await expect(form.work).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(form.work).toHaveValue('90');
  expect(await stored(page)).toEqual(DEFAULTS);

  // The work phase has the widest range, 180 minutes, and its message names its own key.
  await form.every.fill('3');
  await expect(form.every).not.toHaveAttribute('aria-invalid', 'true');
  await form.work.fill('181');
  await form.save.click();
  await expect(await describedError(form.work)).toHaveText('Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180');
  await expect(form.work).toBeFocused();
  await expect(form.every).not.toHaveAttribute('aria-invalid', 'true');
  expect(await stored(page)).toEqual(DEFAULTS);

  // Fixing the value clears the error, and the next save keeps everything typed.
  await form.work.fill('180');
  await expect(form.work).not.toHaveAttribute('aria-invalid', 'true');
  await form.save.click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  expect(await stored(page)).toEqual({ ...DEFAULTS, pomodoro_focus_interval_in_minutes: 180, pomodoro_long_break_every: 3 });
});

test('an empty or fractional number never reaches the server, and its message names the unit', async ({ page, users }) => {
  const form = await openSettings(page, users);
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && PREFERENCES_PATH.test(new URL(request.url()).pathname)) posts += 1;
  });

  await form.shortBreak.fill('');
  await form.every.fill('2.5');
  await form.save.click();
  await expect(await describedError(form.shortBreak)).toHaveText('Enter a whole number of minutes');
  await expect(await describedError(form.every)).toHaveText('Enter a whole number of work phases');
  await expect(form.shortBreak).toBeFocused();
  await expect(form.work).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(posts).toBe(0);
  expect(await stored(page)).toEqual(DEFAULTS);
});

test('a value typed back to the stored one is not an edit, so Save sends no request', async ({ page, users }) => {
  const form = await openSettings(page, users);
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && PREFERENCES_PATH.test(new URL(request.url()).pathname)) posts += 1;
  });

  await form.work.fill('30');
  await form.work.fill('25');
  await form.save.click();
  await expect(page.getByText('No changes to save')).toBeVisible();
  expect(posts).toBe(0);
});

// Preferences stay fresh for a minute, so the page jumps its clock to make the refetch happen.
test('a refetch keeps an unsaved Pomodoro value and its focus, and updates the untouched ones', async ({ page, users }) => {
  await page.clock.install();
  const form = await openSettings(page, users);

  await form.work.fill('40');
  await saveFromAnotherDevice(page, { pomodoro_break_interval_in_minutes: 9, pomodoro_enabled: true });
  await page.clock.fastForward(61_000);
  // Window focus refetches stale queries, at most once a second (packages/web/src/main.tsx).
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(form.shortBreak).toHaveValue('9', { timeout: 1500 });
  }).toPass();
  await expect(form.enabled).toBeChecked();
  await expect(form.work).toHaveValue('40');
  await expect(form.work).toBeFocused();

  const request = page.waitForRequest((candidate) => candidate.method() === 'POST' && PREFERENCES_PATH.test(new URL(candidate.url()).pathname));
  await form.save.click();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  expect((await request).postDataJSON()).toEqual({ pomodoro_focus_interval_in_minutes: 40 });
  expect(await stored(page)).toEqual({
    ...DEFAULTS, pomodoro_enabled: true, pomodoro_break_interval_in_minutes: 9, pomodoro_focus_interval_in_minutes: 40,
  });
});

// The user types the old value back while the save is still on its way.
test('a value typed while a save is pending stays after the response, and Save sends it', async ({ page, users }) => {
  const form = await openSettings(page, users);
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v9/me/preferences', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) await held;
    await route.fallback();
  });

  await form.work.fill('40');
  await form.save.click();
  await expect.poll(() => sent.length).toBe(1);
  await form.work.fill('25');
  await form.longBreak.fill('30');
  release();
  await expect(page.getByText('Preferences saved')).toBeVisible();
  expect((await stored(page)).pomodoro_focus_interval_in_minutes).toBe(40);
  await expect(form.work).toHaveValue('25');
  await expect(form.longBreak).toHaveValue('30');

  await form.save.click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ pomodoro_focus_interval_in_minutes: 25, pomodoro_long_break_interval_in_minutes: 30 });
  await expect.poll(() => stored(page)).toEqual({ ...DEFAULTS, pomodoro_long_break_interval_in_minutes: 30 });
});

// When the pending save fails, the stored values have not changed. A value typed back to the stored
// one is no longer an edit, while a value typed to match the pending save stays one.
test('after a failed save, only a value typed back to the stored one stops being an edit', async ({ page, users, runtimeErrors }) => {
  await page.clock.install();
  const form = await openSettings(page, users);
  runtimeErrors.allowResponse({
    status: 503, method: 'POST', path: PREFERENCES_PATH, reason: 'the held save is answered with an outage',
  });
  let sent = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v9/me/preferences', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent += 1;
    await held;
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Server unavailable' });
  });

  await form.work.fill('40');
  await form.longBreak.fill('20');
  await form.save.click();
  await expect.poll(() => sent).toBe(1);
  await form.work.fill('25');
  await form.longBreak.fill('21');
  await form.longBreak.fill('20');
  release();
  await expect(page.getByRole('alert').filter({ hasText: 'Server unavailable' })).toBeVisible();
  await expect(form.work).toHaveValue('25');
  await expect(form.longBreak).toHaveValue('20');
  expect(await stored(page)).toEqual(DEFAULTS);

  // Another device's change reaches the field that is no longer edited, not the one that is.
  await saveFromAnotherDevice(page, { pomodoro_focus_interval_in_minutes: 35, pomodoro_long_break_interval_in_minutes: 45 });
  await page.clock.fastForward(61_000);
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(form.work).toHaveValue('35', { timeout: 1500 });
  }).toPass();
  await expect(form.longBreak).toHaveValue('20');
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the group fits the screen, with and without field errors, and saves by touch', async ({ page, users, runtimeErrors }) => {
    const form = await openSettings(page, users);
    runtimeErrors.allowResponse({
      status: 400, method: 'POST', path: PREFERENCES_PATH, reason: 'a Pomodoro value is out of range',
    });
    await expectNoPageOverflow(page);
    for (const control of [form.enabled, form.work, form.shortBreak, form.longBreak, form.every, form.stopAtEnd, form.save]) {
      await expectFits(control);
    }

    // The longest message the group shows still wraps inside the screen.
    await form.work.fill('181');
    await form.every.fill('2.5');
    await tap(form.save);
    await expect(await describedError(form.every)).toHaveText('Enter a whole number of work phases');
    await expectFits(await describedError(form.every));
    await form.every.fill('3');
    await tap(form.save);
    const refused = await describedError(form.work);
    await expect(refused).toHaveText('Invalid pomodoro_focus_interval_in_minutes: expected an integer from 1 to 180');
    await expectFits(refused);
    await expectNoPageOverflow(page);

    await form.work.fill('45');
    await tap(form.enabled);
    await tap(form.stopAtEnd);
    await tap(form.save);
    await expect(page.getByText('Preferences saved')).toBeVisible();
    expect(await stored(page)).toEqual({
      ...DEFAULTS, pomodoro_enabled: true, pomodoro_focus_interval_in_minutes: 45, pomodoro_long_break_every: 3, pomodoro_stop_timer_at_end: false,
    });
    await expectNoPageOverflow(page);
  });
});
