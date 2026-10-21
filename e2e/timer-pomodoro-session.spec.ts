import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { describedError, expect, test } from './admin-tests-helpers.ts';
import { login, loginAs } from './helpers.ts';
import { clickNotification, focusCalls, permissionRequests, stubNotifications, type NotificationSetup } from './notification-tests-helpers.ts';
import { RuntimeErrors } from './runtime-errors.ts';
import { TimerApi, instant, metadataOf, type Metadata } from './timer-tests-helpers.ts';

const PREFIX = 'tokkl.pomodoroSession.';
const ENTRIES = /\/api\/v9\/workspaces\/\d+\/time_entries(?:\?.*)?$/;
const LOGOUT = /\/api\/app\/logout$/;
const START = '2026-01-15T09:42:00Z';
const END = '2026-01-15T10:19:00Z';
const FIELDS: Metadata = {
  description: 'Resumed focus', project_id: null, task_id: null, tags: [], billable: false,
};

// Restore a persisted record, then exercise the real provider through the logout buttons.
async function restoreSession(page: Page, accountId: number, options: {
  start?: string; fields?: Metadata; rest?: boolean;
} = {}) {
  const startedAt = Date.parse(options.start ?? START);
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), {
    key: `${PREFIX}${accountId}`,
    state: {
      version: 1, id: 'restored-session', revision: 3, ending: false, unsaved: [],
      config: { workMinutes: 25, shortRestMinutes: 5, longRestMinutes: 15, longRestEvery: 4 },
      fields: options.fields ?? FIELDS, pomodoroStart: startedAt,
      phase: options.rest
        ? { kind: 'shortRest', completed: 2, startedAt: startedAt + 25 * 60_000 }
        : { kind: 'work', completed: 1, startedAt },
    },
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Timer', exact: true })).toBeVisible();
}

const storedSessions = (page: Page) => page.evaluate(
  (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), PREFIX,
);

async function holdPost(page: Page, path: RegExp) {
  const sent = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  await page.route(path, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent.resolve();
    await gate.promise;
    await route.continue();
  });
  return { sent: sent.promise, release: () => gate.resolve() };
}

for (const location of ['navigation', 'settings'] as const) {
  test(`${location} logout saves a restored Pomodoro before clearing storage and revoking the session`, async ({ page, data }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: 15 });
    await page.clock.setFixedTime(new Date(END));
    await login(page);
    const api = await TimerApi.open(page);
    const project_id = await api.createProject('Focus project');
    const task_id = await api.createTask(project_id, 'Focus task');
    const fields = { ...FIELDS, project_id, task_id, tags: ['focus'], billable: true };
    await restoreSession(page, data.userId, { fields, rest: location === 'settings' });
    let button = page.getByRole('button', { name: 'Log out', exact: true });
    if (location === 'settings') {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
      button = page.getByRole('region', { name: 'Session', exact: true }).getByRole('button', { name: 'Log out' });
    }
    const order: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && LOGOUT.test(request.url())) order.push('logout');
    });
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && ENTRIES.test(response.url()) && response.ok()) order.push('saved');
    });
    const held = await holdPost(page, ENTRIES);
    try {
      await button.click();
      await held.sent;
      expect(order).toEqual([]);
      expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).ending, `${PREFIX}${data.userId}`)).toBe(true);
    } finally {
      held.release();
    }
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    expect(order).toEqual(['saved', 'logout']);
    expect(await storedSessions(page)).toEqual([]);

    await login(page);
    const entries = await api.entries();
    expect(entries).toHaveLength(1);
    expect(metadataOf(entries[0]!)).toEqual(fields);
    expect([instant(entries[0]!.start), instant(entries[0]!.stop)]).toEqual([
      Date.parse('2026-01-15T09:45:00Z'), Date.parse('2026-01-15T10:15:00Z'),
    ]);
    expect(await api.current()).toBeNull();
  });
}

test('successive restored Pomodoros save adjacent API boundaries at a 15-minute resolution', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 15 });
  await page.clock.setFixedTime(new Date(END));
  await login(page);
  const api = await TimerApi.open(page);
  await restoreSession(page, data.userId);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-01-15T10:46:00Z'));
  await login(page);
  await restoreSession(page, data.userId, { start: END });
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await login(page);
  const entries = (await api.entries()).sort((a, b) => instant(a.start) - instant(b.start));
  expect(entries).toHaveLength(2);
  expect(entries.map((entry) => [instant(entry.start), instant(entry.stop)])).toEqual([
    [Date.parse('2026-01-15T09:45:00Z'), Date.parse('2026-01-15T10:15:00Z')],
    [Date.parse('2026-01-15T10:15:00Z'), Date.parse('2026-01-15T10:45:00Z')],
  ]);
});

test('logout announces a collapsed Pomodoro without posting an entry', async ({ page, data }) => {
  await page.clock.setFixedTime(new Date(END));
  await login(page);
  await restoreSession(page, data.userId, { start: '2026-01-15T10:18:59Z' });
  let saves = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && ENTRIES.test(request.url())) saves++; });
  const held = await holdPost(page, LOGOUT);
  try {
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await held.sent;
    await expect(page.getByText('This pomodoro was too short to save.', { exact: true })).toBeVisible();
  } finally {
    held.release();
  }
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(saves).toBe(0);
  expect(await data.entries()).toEqual([]);
  expect(await storedSessions(page)).toEqual([]);
});

test('a failed final save still logs out and is not replayed after login', async ({ page, data, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: ENTRIES, reason: 'the final Pomodoro save is deliberately rejected' });
  await page.clock.setFixedTime(new Date(END));
  await login(page);
  await restoreSession(page, data.userId);
  let saves = 0;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    saves++;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '"Final save failed"' });
  });
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await storedSessions(page)).toEqual([]);
  await login(page);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(saves).toBe(1);
  expect(await data.entries()).toEqual([]);
});

test('logout ignores another account\'s persisted Pomodoro and clears its local record', async ({ page, data, users }) => {
  const other = await users.create();
  await page.clock.setFixedTime(new Date(END));
  await loginAs(page, other.account);
  await restoreSession(page, data.userId);
  let saves = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && ENTRIES.test(request.url())) saves++; });
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(saves).toBe(0);
  expect(await storedSessions(page)).toEqual([]);
  expect(await other.entries()).toEqual([]);
  expect(await data.entries()).toEqual([]);
});

test('two tabs logging out while a Pomodoro save is pending post it only once', async ({ page, context, data }, testInfo) => {
  await page.clock.setFixedTime(new Date(END));
  await login(page);
  await restoreSession(page, data.userId);
  const other = await context.newPage();
  const otherErrors = new RuntimeErrors(other);
  await other.goto('/');
  await expect(other.getByRole('region', { name: 'Timer', exact: true })).toBeVisible();
  let saves = 0;
  context.on('request', (request) => { if (request.method() === 'POST' && ENTRIES.test(request.url())) saves++; });
  const held = await holdPost(page, ENTRIES);
  try {
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await held.sent;
    await other.getByRole('button', { name: 'Log out', exact: true }).click();
  } finally {
    held.release();
  }
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(saves).toBe(1);
  expect(await data.entries()).toHaveLength(1);
  expect(await storedSessions(page)).toEqual([]);
  await otherErrors.verify(testInfo);
});

const form = (page: Page) => page.getByRole('form', { name: 'Start a Pomodoro session' });
const session = (page: Page) => page.getByRole('region', { name: 'Running Pomodoro session' });
const banner = (page: Page) => page.getByRole('region', { name: 'Pomodoro phase ended' });
const timer = (page: Page) => page.getByRole('region', { name: 'Timer', exact: true });
const LENGTHS = [
  ['Work (minutes)', 180], ['Short rest (minutes)', 60],
  ['Long rest (minutes)', 60], ['Long rest every (pomodoros)', 12],
] as const;

async function openPomodoro(page: Page) {
  await page.clock.install({ time: new Date(START) });
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
  await expect(session(page).getByRole('timer', { name: 'Time remaining' })).toContainText('0:');
  await expect(page).toHaveTitle(/^Work · .* · Tokkl$/);
  await page.clock.fastForward(65_000);
  await expect(session(page).getByRole('timer', { name: 'Overtime' })).toContainText('+0:');
  await expect(page).toHaveTitle(/^Work · \+.* overtime · Tokkl$/);
  await session(page).getByRole('button', { name: 'Next phase: Short rest' }).click();
  await expect(session(page).getByRole('heading', { name: 'Short rest', exact: true })).toBeVisible();
  await session(page).getByLabel('Description').fill('Edited session');
  await session(page).getByRole('button', { name: 'Next phase: Work' }).click();
  await expect(session(page).getByText('Pomodoro 2 of 2')).toBeVisible();
  await expect.poll(async () => (await api.entries()).filter((entry) => entry.description === 'Edited session').length).toBe(1);
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'Next phase: Long rest' }).click();
  await session(page).getByRole('button', { name: 'Next phase: Work' }).click();
  await expect(session(page).getByText('Pomodoro 1 of 2')).toBeVisible();
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(page)).toBeVisible();
  const saved = (await api.entries()).filter((entry) => entry.description === 'Edited session');
  expect(saved).toHaveLength(2);
  for (const entry of saved) expect(metadataOf(entry)).toEqual({ ...fields, description: 'Edited session' });
  expect(await api.preferences()).toEqual(preferences);
  await expect(page).toHaveTitle('Tokkl');
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
    await page.clock.fastForward(65_000);
    await expect.poll(() => sounding(page)).toEqual([`/sounds/pomodoro-${sound}.wav`]);
    const wraps = await page.evaluate(() => window.sessionAudio.reduce((sum, item) => sum + item.wraps, 0));
    await expect.poll(() => page.evaluate(() => window.sessionAudio.reduce((sum, item) => sum + item.wraps, 0)), { timeout: 8_000 }).toBeGreaterThan(wraps);
    await session(page).getByRole('button', { name: `Next phase: ${next}` }).click();
    await expect.poll(() => sounding(page)).toEqual([]);
    await expect(banner(page)).toHaveCount(0);
  }
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
});

test('rejected audio exposes a retry and global actions cancel the loop on another route', async ({ page }) => {
  await observeAudio(page, true);
  await openPomodoro(page);
  await startPomodoro(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports', exact: true }).click();
  await page.clock.fastForward(65_000);
  await expect(banner(page).getByRole('alert')).toContainText('Sound could not play');
  await page.evaluate(() => { window.rejectSessionAudio = false; });
  await banner(page).getByRole('button', { name: 'Retry sound' }).click();
  await expect.poll(() => sounding(page)).toHaveLength(1);
  await expect(banner(page).getByRole('alert')).toHaveCount(0);
  await banner(page).getByRole('button', { name: 'Next phase' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
  await page.clock.fastForward(65_000);
  await banner(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(page)).toEqual([]);
  await expect(page).toHaveTitle('Tokkl');
});

test('visible unfocused sessions request persistent notifications and close them on Next and End', async ({ page }) => {
  await stubNotifications(page, { permission: 'granted' });
  await page.addInitScript(() => { document.hasFocus = () => false; });
  await openPomodoro(page);
  await startPomodoro(page);
  await page.clock.fastForward(65_000);
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.length)).toBe(1);
  const options = await page.evaluate(() => window.notificationStub.shown[0]!.options);
  expect(options).toMatchObject({ requireInteraction: true, renotify: true, tag: expect.stringMatching(/^tokkl-pomodoro-session-/) });
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await clickNotification(page, 0);
  expect(await focusCalls(page)).toBe(1);
  await session(page).getByRole('button', { name: 'Next phase: Short rest' }).click();
  await page.clock.fastForward(65_000);
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.length)).toBe(2);
  expect(await page.evaluate(() => window.notificationStub.shown[1]!.options.tag)).toBe(options.tag);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => page.evaluate(() => window.notificationStub.shown.every((item) => item.closed))).toBe(true);
});

test('one audio owner hands a ringing session to the other tab when it closes', async ({ page, context }, testInfo) => {
  await observeAudio(page);
  await openPomodoro(page);
  await startPomodoro(page);
  await page.clock.fastForward(65_000);
  await expect.poll(() => sounding(page)).toHaveLength(1);
  const other = await context.newPage();
  const errors = new RuntimeErrors(other);
  await observeAudio(other);
  await other.clock.install({ time: new Date(Date.parse(START) + 65_000) });
  await other.goto('/pomodoro');
  await expect(banner(other)).toBeVisible();
  await other.getByRole('heading', { level: 1 }).click();
  await expect.poll(() => other.evaluate(async () => (await navigator.locks.query()).pending
    ?.filter(({ name }) => name?.startsWith('tokkl.pomodoroSessionAudio.')).length)).toBe(1);
  expect(await sounding(other)).toEqual([]);
  expect(await sounding(page)).toHaveLength(1);
  await page.close();
  await expect.poll(() => sounding(other)).toHaveLength(1);
  await banner(other).getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => sounding(other)).toEqual([]);
  await errors.verify(testInfo);
});

test('starting a session stops the regular timer at its captured start', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  await observeAudio(page);
  const api = await openPomodoro(page);
  await api.savePreferences({ pomodoro_focus_interval_in_minutes: 1 });
  const running = await api.startTimer({ description: 'Regular work', start: '2026-01-15T09:32:00Z' });
  await page.reload();
  await startPomodoro(page);
  expect(await api.current()).toBeNull();
  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), `${PREFIX}${data.userId}`);
  const stopped = (await api.entries()).find((entry) => entry.id === running.id)!;
  expect(instant(stopped.stop)).toBe(Math.round(state.pomodoroStart / 60_000) * 60_000);
  await page.clock.fastForward(65_000);
  await expect.poll(() => sounding(page)).toHaveLength(1);
});

for (const action of ['Start', 'Continue', 'favorite', 'n', 'c', '1', '9'] as const) {
  test(`${action} saves the partial session before starting an adjacent regular timer`, async ({ page, data }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: 1 });
    const api = await openPomodoro(page);
    await api.createEntry({ description: 'Earlier work', start: '2026-01-15T08:00:00Z', stop: '2026-01-15T08:10:00Z' });
    await api.savePreferences({ favorites: Array.from({ length: 9 }, (_, i) => ({ ...FIELDS, description: `Favorite ${i + 1}` })) });
    await page.reload();
    await startPomodoro(page);
    await page.clock.fastForward(65_000);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Timer', exact: true }).click();
    const writes: string[] = [];
    page.on('response', (response) => {
      if (response.ok() && response.request().method() === 'POST' && ENTRIES.test(response.url())) {
        const body = response.request().postDataJSON();
        writes.push(body.stop ? 'session' : 'timer');
      }
    });
    if (action === 'Start') await timer(page).getByRole('button', { name: 'Start timer' }).click();
    else if (action === 'Continue') await page.getByRole('button', { name: 'Continue this entry' }).first().click();
    else if (action === 'favorite') await page.locator('.favorites').getByRole('button', { name: 'Favorite 1', exact: true }).click();
    else await page.keyboard.press(action);
    await expect.poll(() => api.current()).not.toBeNull();
    const running = (await api.current())!;
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => writes).toEqual(['session', 'timer']);
    const saved = (await api.entries()).find((entry) => entry.description === 'Session work')!;
    expect(instant(saved.stop)).toBe(Math.round(instant(running.start) / 60_000) * 60_000);
    await expect.poll(async () => (await page.title()).endsWith(` · ${running.description || 'Running'}`)).toBe(true);
    await page.goto('/pomodoro');
    await expect(form(page)).toBeVisible();
  });
}

test('a remote timer observed on focus ends the session at the remote start', async ({ page, data }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  await startPomodoro(page);
  const remoteStart = '2026-01-15T09:43:00Z';
  await api.startTimer({ description: 'Remote work', start: remoteStart });
  await page.clock.fastForward(65_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(form(page)).toBeVisible();
  const saved = (await api.entries()).find((entry) => entry.description === 'Session work')!;
  expect(instant(saved.stop)).toBe(Date.parse(remoteStart));
  expect((await api.current())?.description).toBe('Remote work');
});

for (const blocked of [false, true]) {
  test(`session start clears paused chains in both tabs with ${blocked ? 'refused' : 'working'} storage`, async ({ page, context }, testInfo) => {
    const other = await context.newPage();
    const errors = new RuntimeErrors(other);
    if (blocked) {
      for (const tab of [page, other]) await tab.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('tokkl.pauseChain.')) throw new DOMException('Full', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      });
    }
    await login(page);
    const api = await TimerApi.open(page);
    await api.startTimer({ description: 'Paused work', start: new Date(Date.now() - 600_000).toISOString() });
    await page.reload();
    await timer(page).getByRole('button', { name: 'Pause timer' }).click();
    await expect(timer(page).getByRole('button', { name: 'Resume timer' })).toBeVisible();
    await other.goto('/pomodoro');
    await startPomodoro(other);
    await expect(timer(page).getByRole('button', { name: 'Resume timer' })).toHaveCount(0);
    await expect(timer(page).getByRole('button', { name: 'Start timer' })).toBeVisible();
    await other.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Timer', exact: true }).click();
    await expect(timer(other).getByRole('button', { name: 'Resume timer' })).toHaveCount(0);
    expect(await api.current()).toBeNull();
    await errors.verify(testInfo);
  });
}

test('a session start preserves the rounded-to-zero timer trash toast and Undo', async ({ page }) => {
  const api = await openPomodoro(page);
  const running = await api.startTimer({ description: 'Brief timer', start: START });
  await startPomodoro(page);
  await expect.poll(() => api.trash()).toHaveLength(1);
  expect((await api.trash())[0]!.id).toBe(running.id);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => api.trash()).toEqual([]);
  expect((await api.entries()).some((entry) => entry.id === running.id)).toBe(true);
  await expect(session(page)).toBeVisible();
});

async function endWithFailure(page: Page, api: TimerApi) {
  await startPomodoro(page);
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(form(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 unsaved pomodoro.' })).toBeVisible();
  expect(await api.entries()).toEqual([]);
}

for (const wake of ['reload', 'focus', 'online', 'backoff'] as const) {
  test(`an unsaved ended session recovers once on ${wake}`, async ({ page, data, runtimeErrors }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: 1 });
    const api = await openPomodoro(page);
    runtimeErrors.allowResponse({ status: 503, method: 'POST', path: ENTRIES, reason: 'save temporarily unavailable' });
    let failing = true;
    const payloads: unknown[] = [];
    await page.route(ENTRIES, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      payloads.push(route.request().postDataJSON());
      if (failing) return route.fulfill({ status: 503, contentType: 'application/json', body: '"Save temporarily unavailable"' });
      await route.continue();
    });
    await endWithFailure(page, api);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), `${PREFIX}${data.userId}`);
    expect(stored.unsaved).toHaveLength(1);
    expect(stored.unsaved[0].entry.description).toBe('Session work');
    failing = false;
    if (wake === 'reload') {
      await page.reload();
      await expect(form(page)).toBeVisible();
    }
    if (wake === 'focus' || wake === 'online') await page.evaluate((event) => window.dispatchEvent(new Event(event)), wake);
    else await page.clock.fastForward(11_000);
    await expect.poll(() => api.entries()).toHaveLength(1);
    await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    for (const payload of payloads) expect(payload).toEqual(payloads[0]);
    await page.clock.fastForward(30_000);
    expect(await api.entries()).toHaveLength(1);
  });
}

test('a completed phase keeps its immutable fields when the next work is edited before retry', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: ENTRIES, reason: 'hold the completed phase in the save queue' });
  let failing = true;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST' || !failing) return route.continue();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '"Try later"' });
  });
  await startPomodoro(page, 'Original fields');
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'Next phase: Short rest' }).click();
  await session(page).getByRole('button', { name: 'Next phase: Work' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 unsaved pomodoro.' })).toBeVisible();
  await session(page).getByLabel('Description').fill('Later fields');
  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => api.entries()).toHaveLength(1);
  expect((await api.entries())[0]!.description).toBe('Original fields');
  await expect(session(page).getByLabel('Description')).toHaveValue('Later fields');
});

test('an uncertain successful POST reconciles actual entries without posting a duplicate', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 502, method: 'POST', path: ENTRIES, reason: 'server commits but proxy loses the successful response' });
  let posts = 0;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.fulfill({ status: 502, contentType: 'application/json', body: '"Response lost"' });
  });
  await startPomodoro(page);
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 unsaved pomodoro.' })).toBeVisible();
  await page.reload();
  await expect(form(page)).toBeVisible();
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
  expect(await api.entries()).toHaveLength(1);
  expect(posts).toBe(1);
});

test('an irrecoverable save displays the server message and drops the queue item', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 400, method: 'POST', path: ENTRIES, reason: 'server rejects the completed Pomodoro' });
  let posts = 0;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    await route.fulfill({ status: 400, contentType: 'application/json', body: '"Project no longer exists"' });
  });
  await startPomodoro(page);
  await page.clock.fastForward(65_000);
  await session(page).getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Project no longer exists', { exact: true })).toBeVisible();
  await expect(form(page)).toBeVisible();
  await page.clock.fastForward(30_000);
  expect(posts).toBe(1);
  expect(await api.entries()).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
});

for (const status of [401, 408, 429]) {
  test(`a ${status} save response retains the pending Pomodoro for reconnect`, async ({ page, data, runtimeErrors }) => {
    await data.saveInstanceSettings({ time_resolution_minutes: 1 });
    const api = await openPomodoro(page);
    runtimeErrors.allowResponse({ status, method: 'POST', path: ENTRIES, reason: 'transient client-status response must retain work' });
    let failing = true;
    await page.route(ENTRIES, async (route) => {
      if (route.request().method() !== 'POST' || !failing) return route.continue();
      await route.fulfill({ status, contentType: 'application/json', body: '"Retry after reconnect"' });
    });
    await endWithFailure(page, api);
    failing = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => api.entries()).toHaveLength(1);
    await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
  });
}

test('two tabs waking a pending save share one retry and clear both unsaved counts', async ({ page, context, data, runtimeErrors }, testInfo) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  const failure = { status: 503, method: 'POST', path: ENTRIES, reason: 'queue one pending Pomodoro before both tabs wake' };
  runtimeErrors.allowResponse(failure);
  let failing = true;
  let posts = 0;
  const sent = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  await context.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    if (failing) return route.fulfill({ status: 503, contentType: 'application/json', body: '"Try again"' });
    sent.resolve();
    await gate.promise;
    await route.continue();
  });
  await endWithFailure(page, api);
  const other = await context.newPage();
  const errors = new RuntimeErrors(other);
  errors.allowResponse(failure);
  await other.clock.install({ time: new Date(Date.parse(START) + 65_000) });
  await other.goto('/pomodoro');
  await expect(other.getByRole('status').filter({ hasText: '1 unsaved pomodoro.' })).toBeVisible();
  const before = posts;
  failing = false;
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sent.promise;
    await other.evaluate(() => window.dispatchEvent(new Event('online')));
  } finally { gate.resolve(); }
  await expect.poll(() => api.entries()).toHaveLength(1);
  for (const tab of [page, other]) await expect(tab.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
  expect(posts).toBe(before + 1);
  await errors.verify(testInfo);
});

test('refused session storage retains a failed save in memory until reconnect', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('tokkl.pomodoroSession.')) throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 503, method: 'POST', path: ENTRIES, reason: 'in-memory queue survives temporary server failure' });
  let failing = true;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST' || !failing) return route.continue();
    await route.fulfill({ status: 503, contentType: 'application/json', body: '"Try again"' });
  });
  await endWithFailure(page, api);
  expect(await storedSessions(page)).toEqual([]);
  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => api.entries()).toHaveLength(1);
  await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
});

test('reload recovers the durable End claim without recalculating its queued span', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 503, method: 'POST', path: ENTRIES, reason: 'capture the durable state during an interrupted End' });
  let claim: string | null = null;
  let failing = true;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST' || !failing) return route.continue();
    claim = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}${data.userId}`);
    await route.fulfill({ status: 503, contentType: 'application/json', body: '"Try again"' });
  });
  await endWithFailure(page, api);
  expect(JSON.parse(claim!).ending).toBe(true);
  const queued = JSON.parse(claim!).unsaved[0].entry;
  // Restore the exact durable record left if the browser exits before End's finally block.
  await page.evaluate(({ key, claim }) => localStorage.setItem(key, claim!), { key: `${PREFIX}${data.userId}`, claim });
  failing = false;
  await page.reload();
  await expect(form(page)).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect.poll(() => api.entries()).toHaveLength(1);
  const [entry] = await api.entries();
  expect([instant(entry!.start), instant(entry!.stop)]).toEqual([Date.parse(queued.start), Date.parse(queued.stop)]);
  await expect(page.getByRole('status').filter({ hasText: 'unsaved pomodoro' })).toHaveCount(0);
});

test('explicit signout clears an ended unsaved queue without replaying it on login', async ({ page, data, runtimeErrors }) => {
  await data.saveInstanceSettings({ time_resolution_minutes: 1 });
  const api = await openPomodoro(page);
  runtimeErrors.allowResponse({ status: 503, method: 'POST', path: ENTRIES, reason: 'leave pending work for explicit signout cleanup' });
  let posts = 0;
  await page.route(ENTRIES, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '"Try again"' });
  });
  await endWithFailure(page, api);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await storedSessions(page)).toEqual([]);
  const before = posts;
  await login(page);
  await page.clock.fastForward(61_000);
  expect(posts).toBe(before);
  expect(await api.entries()).toEqual([]);
});
