import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { describedError, expect, test } from './admin-tests-helpers.ts';
import { login } from './helpers.ts';
import { clickNotification, focusCalls, permissionRequests, stubNotifications, type NotificationSetup } from './notification-tests-helpers.ts';
import { RuntimeErrors } from './runtime-errors.ts';
import {
  expectSnapped, holdRequest, instant, metadataOf, nextRunning, openSecondDevice, settleTimerTraffic, TimerApi,
  watchTimerTraffic, type Metadata,
} from './timer-tests-helpers.ts';

// The server owns the session: it sets every phase start and planned end, and a device only shows
// them and rings. A fake browser clock cannot move the server, so a test moves it past a planned
// end with `ring` once every timer state has arrived (the page takes its clock offset from the
// latest state). The server stores a pomodoro that ran under half a resolution step in the trash,
// so a scenario that needs the stored entry backdates the running one first, as an edit from
// another client would.

const START = '2026-01-15T09:42:00Z';
const FIELDS: Metadata = {
  description: 'Resumed focus', project_id: null, task_id: null, tags: [], billable: false,
};
const STEP = 60_000;

const form = (page: Page) => page.getByRole('form', { name: 'Start a Pomodoro session' });
const session = (page: Page) => page.getByRole('region', { name: 'Running Pomodoro session' });
const banner = (page: Page) => page.getByRole('region', { name: 'Pomodoro phase ended' });
const timer = (page: Page) => page.getByRole('region', { name: 'Timer', exact: true });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const LENGTHS = [
  ['Work (minutes)', 180], ['Short rest (minutes)', 60],
  ['Long rest (minutes)', 60], ['Long rest every (pomodoros)', 12],
] as const;

/** Opens the Pomodoro page. `fakeClock: false` keeps the browser clock real, for scenarios where the page writes its own timestamps. */
async function openPomodoro(page: Page, { fakeClock = true } = {}) {
  await watchTimerTraffic(page);
  if (fakeClock) await page.clock.install({ time: new Date(START) });
  await login(page);
  await page.goto('/pomodoro');
  await expect(form(page)).toBeVisible();
  return TimerApi.open(page);
}

async function startPomodoro(page: Page, description = 'Session work') {
  for (const [label] of LENGTHS) await form(page).getByLabel(label, { exact: true }).fill('1');
  await form(page).getByLabel('Long rest every (pomodoros)').fill('2');
  await form(page).getByLabel('Description').fill(description);
  await form(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(session(page)).toBeVisible();
}

/** Moves the browser clock past the end of a one-minute phase, once the server's states have all arrived. */
async function ring(page: Page) {
  await settleTimerTraffic(page);
  await page.clock.fastForward(65_000);
}

/** Moves the running entry's start two minutes back and waits until the page has the change. */
async function backdate(page: Page, api: TimerApi) {
  const running = (await api.current())!;
  const moved = await api.backdate(running.id, 2);
  await settleTimerTraffic(page);
  return moved;
}

/** The server's timer state, without the time it was read at. */
async function serverState(page: Page) {
  const { server_time: _, ...state } = await (await page.request.get('/api/app/timer')).json() as Record<string, unknown>;
  return state as { revision: number; pomodoro: { phase: { kind: string; start: string } } | null };
}

// Retain native media playback: observe decoded audio and time wrapping at the loop boundary.
declare global {
  interface Window {
    sessionAudio: { element: HTMLMediaElement; wraps: number }[];
    audioGestures: boolean[];
    rejectSessionAudio: boolean;
  }
}
async function observeAudio(page: Page, reject = false) {
  await page.addInitScript((reject) => {
    window.sessionAudio = [];
    window.audioGestures = [];
    window.rejectSessionAudio = reject;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.audioGestures.push(navigator.userActivation.isActive);
      if (!window.sessionAudio.some(({ element }) => element === this)) {
        const record = { element: this, wraps: 0 };
        let previous = 0;
        let source = this.src;
        this.addEventListener('timeupdate', () => {
          if (this.src !== source) { previous = 0; source = this.src; }
          if (this.loop && !this.paused && previous > this.duration / 2 && this.currentTime < previous) record.wraps++;
          previous = this.currentTime;
        });
        window.sessionAudio.push(record);
      }
      if (window.rejectSessionAudio) return Promise.reject(new DOMException('Blocked for retry test', 'NotAllowedError'));
      return play.call(this);
    };
  }, reject);
}
const sounding = (page: Page) => page.evaluate(() => window.sessionAudio
  .filter(({ element }) => !element.paused && element.loop && element.volume > 0)
  .map(({ element }) => new URL(element.src).pathname));

test('one-minute sessions retain entry fields, skip phases, count overtime and leave preferences unchanged', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  const preferences = await api.preferences();
  for (const [label, key] of [
    ['Work (minutes)', 'pomodoro_focus_interval_in_minutes'],
    ['Short rest (minutes)', 'pomodoro_break_interval_in_minutes'],
    ['Long rest (minutes)', 'pomodoro_long_break_interval_in_minutes'],
    ['Long rest every (pomodoros)', 'pomodoro_long_break_every'],
  ]) await expect(form(page).getByLabel(label!, { exact: true })).toHaveValue(String(preferences[key!]));
  const project_id = await api.createProject('Session project');
  const task_id = await api.createTask(project_id, 'Session task');
  const fields = { ...FIELDS, description: 'Session template', project_id, task_id, tags: ['focus'], billable: true };
  await api.createEntry({ ...fields, start: '2026-01-15T08:00:00Z', stop: '2026-01-15T08:10:00Z' });
  await page.reload();
  await form(page).getByLabel('Description').fill('Session temp');
  await page.locator('.suggestions').getByRole('button', { name: /Session template/ }).click();
  await startPomodoro(page, fields.description);
  await expect(session(page).getByText('Pomodoro 1 of 2')).toBeVisible();
  await expect(session(page).getByRole('timer', { name: 'Time remaining' })).toContainText(/\d:\d\d/);
  await expect(page).toHaveTitle(/^Work · .* · Tokkl$/);
  await settleTimerTraffic(page);
  const first = await backdate(page, api);
  await ring(page);
  await expect(session(page).getByRole('timer', { name: 'Overtime' })).toContainText('+0:');
  await expect(page).toHaveTitle(/^Work · \+.* overtime · Tokkl$/);
  await session(page).getByRole('button', { name: 'Next phase: Short rest' }).click();
  await expect(session(page).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();
  await session(page).getByLabel('Description').fill('Edited session');
  await session(page).getByRole('button', { name: 'Next phase: Work' }).click();
  await expect(session(page).getByText('Pomodoro 2 of 2')).toBeVisible();
  // The first pomodoro is stored; the second, which copied its fields, is the running entry.
  await expect.poll(async () => (await api.entries()).filter((entry) => entry.description === 'Edited session' && entry.stop !== null).length).toBe(1);
  const second = await backdate(page, api);
  expect(second.id).not.toBe(first.id);
  await ring(page);
  await session(page).getByRole('button', { name: 'Next phase: Long rest' }).click();
  await session(page).getByRole('button', { name: 'Next phase: Work' }).click();
  await expect(session(page).getByText('Pomodoro 1 of 2')).toBeVisible();
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(page)).toBeVisible();
  const saved = (await api.entries()).filter((entry) => entry.description === 'Edited session').sort((a, b) => instant(a.start) - instant(b.start));
  expect(saved).toHaveLength(2);
  for (const entry of saved) expect(metadataOf(entry)).toEqual({ ...fields, description: 'Edited session' });
  expectSnapped(saved[0]!, first.start, STEP);
  expectSnapped(saved[1]!, second.start, STEP);
  expect(await api.preferences()).toEqual(preferences);
  await expect(page).toHaveTitle('Tokkl');
});

test('the Pomodoro nav item marks a running session on every page until it ends', async ({ page }) => {
  await openPomodoro(page);
  const running = nav(page).getByRole('link', { name: 'Pomodoro session running' });
  await expect(nav(page).getByRole('link', { name: 'Pomodoro', exact: true })).toBeVisible();
  await expect(running).toHaveCount(0);
  await startPomodoro(page);
  await expect(running).toHaveCount(1);
  await expect(running).toHaveAttribute('href', '/pomodoro');
  await expect(running.locator('.running-dot')).toHaveAttribute('title', 'Pomodoro session running');

  await nav(page).getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(running).toHaveCount(1);
  await page.reload();
  await expect(running).toHaveCount(1);

  await running.click();
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(page)).toBeVisible();
  await expect(running).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Pomodoro', exact: true })).toHaveAttribute('aria-current', 'page');
});

for (const [label, max] of LENGTHS) {
  test(`${label} rejects invalid lengths with an associated error and focus`, async ({ page }) => {
    await openPomodoro(page);
    const control = form(page).getByLabel(label, { exact: true });
    for (const value of ['0', String(max + 1), '1.5', '']) {
      await control.fill(value);
      await form(page).getByRole('button', { name: 'Start', exact: true }).click();
      await expect(await describedError(control)).toHaveText(`Enter a whole number from 1 to ${max}.`);
      await expect(control).toBeFocused();
      await expect(session(page)).toHaveCount(0);
    }
    await control.fill(String(max));
    await form(page).getByRole('button', { name: 'Start', exact: true }).click();
    await expect(session(page)).toBeVisible();
  });
}

for (const [name, setup, message] of [
  ['granted', { permission: 'granted' }, 'Notifications are allowed.'],
  ['denied', { permission: 'denied' }, 'Notifications are blocked.'],
  ['unsupported', { support: 'missing' }, "This browser can't show notifications."],
  ['insecure', { secure: false }, 'Notifications need HTTPS.'],
] as [string, NotificationSetup, string][]) {
  test(`the Pomodoro page explains ${name} notification access`, async ({ page }) => {
    await stubNotifications(page, setup);
    await openPomodoro(page);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow notifications' })).toHaveCount(0);
    expect(await permissionRequests(page)).toBe(0);
  });
}

test('notification permission requires a click and moves focus to its answer', async ({ page }) => {
  await stubNotifications(page);
  await openPomodoro(page);
  expect(await permissionRequests(page)).toBe(0);
  await page.getByRole('button', { name: 'Allow notifications' }).click();
  await expect(page.getByRole('button', { name: 'Allow notifications' })).toHaveCount(0);
  await expect(page.getByText(/^Notifications are allowed\./)).toBeFocused();
  expect(await permissionRequests(page)).toBe(1);
});

test('the built app serves each transition sound as the committed WAV', async ({ page }) => {
  await login(page);
  for (const name of ['work-to-short-rest', 'short-rest-to-work', 'work-to-long-rest', 'long-rest-to-work']) {
    const file = `pomodoro-${name}.wav`;
    const response = await page.request.get(`/sounds/${file}`);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['content-type'], file).toBe('audio/wav');
    expect((await response.body()).equals(readFileSync(new URL(`../packages/web/public/sounds/${file}`, import.meta.url))), file).toBe(true);
  }
});

test('all four native WAV alarms loop until an action and unlock in the Start gesture', async ({ page }) => {
  await observeAudio(page);
  await openPomodoro(page);
  await startPomodoro(page);
  expect(await page.evaluate(() => window.audioGestures[0])).toBe(true);
  for (const [sound, next] of [
    ['work-to-short-rest', 'Short rest'], ['short-rest-to-work', 'Work'],
    ['work-to-long-rest', 'Long rest'], ['long-rest-to-work', 'Work'],
  ]) {
    await ring(page);
    await expect.poll(() => sounding(page)).toEqual([`/sounds/pomodoro-${sound}.wav`]);
    const wraps = await page.evaluate(() => window.sessionAudio.reduce((sum, item) => sum + item.wraps, 0));
    await expect.poll(() => page.evaluate(() => window.sessionAudio.reduce((sum, item) => sum + item.wraps, 0)), { timeout: 8_000 }).toBeGreaterThan(wraps);
    await session(page).getByRole('button', { name: `Next phase: ${next}` }).click();
    await expect.poll(() => sounding(page)).toEqual([]);
    await expect(banner(page)).toHaveCount(0);
  }
  await ring(page);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
});

test('rejected audio exposes a retry and global actions cancel the loop on another route', async ({ page }) => {
  await observeAudio(page, true);
  await openPomodoro(page);
  await startPomodoro(page);
  await nav(page).getByRole('link', { name: 'Reports', exact: true }).click();
  await ring(page);
  await expect(banner(page).getByRole('alert')).toContainText('Sound could not play');
  await page.evaluate(() => { window.rejectSessionAudio = false; });
  await banner(page).getByRole('button', { name: 'Retry sound' }).click();
  await expect.poll(() => sounding(page)).toHaveLength(1);
  await expect(banner(page).getByRole('alert')).toHaveCount(0);
  await banner(page).getByRole('button', { name: 'Next phase' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
  await ring(page);
  await banner(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
  await expect(page).toHaveTitle('Tokkl');
});

test('visible unfocused sessions request persistent notifications and close them on Next and End', async ({ page }) => {
  await stubNotifications(page, { permission: 'granted' });
  await page.addInitScript(() => { document.hasFocus = () => false; });
  await openPomodoro(page);
  await startPomodoro(page);
  await ring(page);
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.length)).toBe(1);
  const options = await page.evaluate(() => window.notificationStub.shown[0]!.options);
  // The tag is the phase start, which the server sets, so every tab ringing for the phase shares one notification.
  const phase = (await serverState(page)).pomodoro!.phase;
  expect(options).toMatchObject({ requireInteraction: true, renotify: true, tag: `tokkl-pomodoro-session-${phase.start}` });
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await clickNotification(page, 0);
  expect(await focusCalls(page)).toBe(1);
  await session(page).getByRole('button', { name: 'Next phase: Short rest' }).click();
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown[0]!.closed)).toBe(true);
  await ring(page);
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.length)).toBe(2);
  const next = (await serverState(page)).pomodoro!.phase;
  expect(next.start).not.toBe(phase.start);
  expect(await page.evaluate(() => window.notificationStub.shown[1]!.options.tag)).toBe(`tokkl-pomodoro-session-${next.start}`);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.every((item) => item.closed))).toBe(true);
});

test('one audio owner hands a ringing session to the other tab when it closes', async ({ page, context }, testInfo) => {
  await observeAudio(page);
  await openPomodoro(page);
  await startPomodoro(page);
  await ring(page);
  await expect.poll(() => sounding(page)).toHaveLength(1);
  const other = await context.newPage();
  const errors = new RuntimeErrors(other);
  await observeAudio(other);
  await watchTimerTraffic(other);
  await other.clock.install({ time: new Date(START) });
  await other.goto('/pomodoro');
  await expect(session(other)).toBeVisible();
  await ring(other);
  await expect(banner(other)).toBeVisible();
  await other.getByRole('heading', { level: 1 }).click();
  await expect.poll(() => other.evaluate(async () => (await navigator.locks.query()).pending
    ?.filter(({ name }) => name?.startsWith('tokkl.pomodoroAudio.')).length)).toBe(1);
  expect(await sounding(other)).toEqual([]);
  expect(await sounding(page)).toHaveLength(1);
  await page.close();
  await expect.poll(() => sounding(other)).toHaveLength(1);
  await banner(other).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(other)).toEqual([]);
  await errors.verify(testInfo);
});

test('starting a session stops the regular timer at the new pomodoro\'s start', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  const running = await api.startTimer({ description: 'Regular work', start: new Date(Date.now() - 10 * 60_000).toISOString() });
  await startPomodoro(page);
  const pomodoro = (await api.current())!;
  expect(pomodoro.id).not.toBe(running.id);
  expect(pomodoro.description).toBe('Session work');
  const stopped = (await api.entries()).find((entry) => entry.id === running.id)!;
  expect(instant(stopped.stop)).toBe(Math.round(instant(pomodoro.start) / STEP) * STEP);
  expect(stopped.description).toBe('Regular work');
});

for (const action of ['Start', 'Continue', 'favorite'] as const) {
  test(`${action} on the Timer page ends the session and saves the partial pomodoro`, async ({ page, data }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: 1 });
    // The timer the page starts takes its start from the browser clock, which has to agree with the server's.
    const api = await openPomodoro(page, { fakeClock: false });
    const earlier = Date.now() - 60 * 60_000;
    await api.createEntry({ description: 'Earlier work', start: new Date(earlier).toISOString(), stop: new Date(earlier + 10 * 60_000).toISOString() });
    await api.savePreferences({ favorites: [{ ...FIELDS, description: 'Favorite 1' }] });
    await page.reload();
    await startPomodoro(page);
    const pomodoro = (await api.current())!;
    const moved = await backdate(page, api);
    await nav(page).getByRole('link', { name: 'Timer', exact: true }).click();
    if (action === 'Start') await timer(page).getByRole('button', { name: 'Start timer' }).click();
    else if (action === 'Continue') await page.getByRole('button', { name: 'Continue this entry' }).first().click();
    else await page.locator('.favorites').getByRole('button', { name: 'Favorite 1', exact: true }).click();
    const running = await nextRunning(api, pomodoro.id);
    await expect(banner(page)).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Pomodoro session running' })).toHaveCount(0);
    const saved = (await api.entries()).find((entry) => entry.id === pomodoro.id)!;
    expect(saved.description).toBe('Session work');
    expect(instant(saved.stop)).toBe(Math.round(instant(running.start) / STEP) * STEP);
    expectSnapped(saved, moved.start, STEP);
    expect((await serverState(page)).pomodoro).toBeNull();
    await expect.poll(async () => (await page.title()).endsWith(` · ${running.description || 'Running'}`)).toBe(true);
    await page.goto('/pomodoro');
    await expect(form(page)).toBeVisible();
  });
}

test('a remote timer ends the session at the remote start without a reload', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  await startPomodoro(page);
  const moved = await backdate(page, api);
  const remote = await api.startTimer({ description: 'Remote work', start: new Date().toISOString() });
  await expect(form(page)).toBeVisible();
  const saved = (await api.entries()).find((entry) => entry.description === 'Session work')!;
  expect(instant(saved.stop)).toBe(Math.round(instant(remote.start) / STEP) * STEP);
  expectSnapped(saved, moved.start, STEP);
  expect((await api.current())?.id).toBe(remote.id);
});

test('a too-short pomodoro is announced and goes to the trash', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  await startPomodoro(page);
  const pomodoro = (await api.current())!;
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(page)).toBeVisible();
  await expect(page.getByText('This pomodoro was too short to save.', { exact: true })).toBeVisible();
  expect((await api.trash()).map((entry) => entry.id)).toEqual([pomodoro.id]);
  expect(await api.entries()).toEqual([]);
});

// What a person does on two devices: the second one is a separate browser context signed in as the same user.
async function secondDevice(page: Page, browser: Parameters<typeof openSecondDevice>[1]) {
  return openSecondDevice(page, browser, {
    path: '/pomodoro',
    prepare: async (other) => {
      await observeAudio(other);
      await watchTimerTraffic(other);
      await other.clock.install({ time: new Date(START) });
    },
  });
}

test('a session started on one device shows on the other, and Next phase there stops this device\'s alarm', async ({ page, browser, data }, testInfo) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  await observeAudio(page);
  const api = await openPomodoro(page);
  const { other, errors } = await secondDevice(page, browser);
  await expect(form(other)).toBeVisible();

  // Nothing reloads or focuses the other device: the server pushes the session.
  await startPomodoro(page);
  await expect(session(other)).toBeVisible({ timeout: 2_000 });
  await expect(session(other).getByText('Pomodoro 1 of 2')).toBeVisible();
  await expect(nav(other).getByRole('link', { name: 'Pomodoro session running' })).toBeVisible();
  await expect(other).toHaveTitle(/^Work · .* · Tokkl$/);
  const moved = await backdate(page, api);
  await settleTimerTraffic(other);

  // Both devices ring for the same phase, each with its own audio.
  await other.getByRole('heading', { level: 1 }).click();
  await Promise.all([ring(page), ring(other)]);
  await expect(banner(page)).toBeVisible();
  await expect(banner(other)).toBeVisible();
  await expect.poll(() => sounding(page)).toHaveLength(1);
  await expect.poll(() => sounding(other)).toHaveLength(1);

  // Next phase on one device silences the other without a click there.
  await banner(other).getByRole('button', { name: 'Next phase' }).click();
  await expect(banner(page)).toHaveCount(0, { timeout: 2_000 });
  await expect.poll(() => sounding(page)).toEqual([]);
  await expect.poll(() => sounding(other)).toEqual([]);
  await expect(session(page).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();
  await expect(session(other).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();

  // End session on the first device ends it on the second, and the pomodoro is stored once.
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(other)).toBeVisible({ timeout: 2_000 });
  const saved = await api.entries();
  expect(saved).toHaveLength(1);
  expect(saved[0]!.description).toBe('Session work');
  expectSnapped(saved[0]!, moved.start, STEP);
  await errors.verify(testInfo);
});

test('a second confirm with an old revision gets a conflict, advances nothing and shows the other device\'s phase', async ({ page, browser, data, runtimeErrors }, testInfo) => {
  runtimeErrors.allowResponse({ status: 409, method: 'POST', path: /\/api\/app\/pomodoro\/next$/, reason: 'both devices confirm the same phase end' });
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  await observeAudio(page);
  const api = await openPomodoro(page);
  const { other, errors } = await secondDevice(page, browser);
  await expect(form(other)).toBeVisible();
  await startPomodoro(page);
  await expect(session(other)).toBeVisible({ timeout: 2_000 });
  await settleTimerTraffic(other);
  await Promise.all([ring(page), ring(other)]);
  await expect(banner(page)).toBeVisible();
  await expect(banner(other)).toBeVisible();

  // This device's confirm waits on the network while the other device confirms the same phase end.
  const held = await holdRequest(page, /\/api\/app\/pomodoro\/next$/);
  await banner(page).getByRole('button', { name: 'Next phase' }).click();
  await held.sent;
  await banner(other).getByRole('button', { name: 'Next phase' }).click();
  await expect(session(other).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();
  await expect(session(page).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible({ timeout: 2_000 });
  const settled = await serverState(page);
  expect(settled.pomodoro!.phase.kind).toBe('shortRest');

  held.release();
  await expect(page.getByRole('alert').filter({ hasText: 'Another device changed the timer first.' })).toBeVisible();
  expect(await serverState(page)).toEqual(settled);
  await expect(session(page).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  // Only the running pomodoro exists: the second confirm stored and started nothing.
  expect((await api.entries()).map((entry) => entry.stop)).toEqual([null]);
  await errors.verify(testInfo);
});

test('a session start on one device ends a paused chain on the other', async ({ page, browser }, testInfo) => {
  await login(page);
  const api = await TimerApi.open(page);
  await api.startTimer({ description: 'Paused work', start: new Date(Date.now() - 600_000).toISOString() });
  await page.reload();
  await timer(page).getByRole('button', { name: 'Pause timer' }).click();
  await expect(timer(page).getByRole('button', { name: 'Resume timer' })).toBeVisible();
  const { other, errors } = await openSecondDevice(page, browser, { path: '/pomodoro' });
  await expect(form(other)).toBeVisible();

  await startPomodoro(other);
  await expect(timer(page).getByRole('button', { name: 'Resume timer' })).toHaveCount(0);
  await expect(timer(page).getByRole('button', { name: 'Start timer' })).toBeVisible();
  expect((await serverState(page) as { pause?: unknown }).pause).toBeNull();
  await nav(other).getByRole('link', { name: 'Timer', exact: true }).click();
  await expect(timer(other).getByRole('button', { name: 'Resume timer' })).toHaveCount(0);
  expect((await api.current())?.description).toBe('Session work');
  await errors.verify(testInfo);
});
