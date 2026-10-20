import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type ExtraUsers } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import {
  clickNotification, focusCalls, permissionRequests, setHidden, shownNotifications, stubNotifications, type NotificationSetup,
} from './notification-tests-helpers.ts';
import { holdNextStop, TimerApi } from './timer-tests-helpers.ts';

// The Pomodoro in the timer bar. Work phases count accrued running time, breaks count elapsed time
// on this device, and a phase end rings the bell once and shows a banner. page.clock jumps the
// browser's time with fastForward; it keeps running at normal speed in between, so countdowns are
// checked within a few seconds. The server keeps real time, which is why the lengths are short.
// Each scenario signs in as an extra account of its own. The data fixture also puts the worker
// account's Pomodoro preferences back to their defaults after every test.

const WORK = 120;
const SHORT = 60;
const LONG = 180;
const BELL = '/sounds/pomodoro-bell.mp3';
const TRANSITIONS = ['work-to-short-rest', 'short-rest-to-work', 'work-to-long-rest', 'long-rest-to-work'];

declare global {
  interface Window {
    bellPlays: string[];
  }
}

interface Setup {
  stopAtEnd: boolean;
  longBreakEvery?: number;
  enabled?: boolean;
  rejectPlay?: boolean;
  /** Stubs window.Notification and the page's visibility; see stubNotifications. */
  notifications?: NotificationSetup;
}

/** Signs in as a new account with the Pomodoro set up, a fake clock and a play() stub that counts rings. */
async function open(page: Page, users: ExtraUsers, { stopAtEnd, longBreakEvery = 4, enabled = true, rejectPlay = false, notifications }: Setup) {
  if (notifications) await stubNotifications(page, notifications);
  await page.addInitScript((reject) => {
    window.bellPlays = [];
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      window.bellPlays.push(this.src);
      return reject ? Promise.reject(new DOMException('Autoplay is blocked', 'NotAllowedError')) : Promise.resolve();
    };
  }, rejectPlay);
  await page.clock.install();
  await loginAs(page, (await users.create()).account);
  const api = await TimerApi.open(page);
  await api.savePreferences({
    pomodoro_enabled: enabled,
    pomodoro_focus_interval_in_minutes: WORK / 60,
    pomodoro_break_interval_in_minutes: SHORT / 60,
    pomodoro_long_break_interval_in_minutes: LONG / 60,
    pomodoro_long_break_every: longBreakEvery,
    pomodoro_stop_timer_at_end: stopAtEnd,
  });
  await page.reload();
  const timer = page.getByRole('region', { name: 'Timer' });
  await expect(timer).toBeVisible();
  return { api, ui: bar(page, timer) };
}

function bar(page: Page, timer: Locator) {
  return {
    timer,
    description: timer.getByLabel('Description'),
    start: timer.getByRole('button', { name: 'Start timer' }),
    pause: timer.getByRole('button', { name: 'Pause timer' }),
    resume: timer.getByRole('button', { name: 'Resume timer' }),
    stop: timer.getByRole('button', { name: 'Stop timer' }),
    runningClock: timer.getByRole('button', { name: /elapsed, edit start time$/ }),
    countdown: timer.getByRole('timer', { name: / left$/ }),
    banner: timer.getByRole('status'),
    dismiss: timer.getByRole('button', { name: 'Dismiss' }),
    plays: () => page.evaluate(() => window.bellPlays.length),
  };
}

type Bar = ReturnType<typeof bar>;

/** The countdown's phase and seconds, read from its accessible name such as "Work, 1:59 left". */
async function readCountdown(countdown: Locator): Promise<{ phase: string; seconds: number }> {
  const label = (await countdown.getAttribute('aria-label')) ?? '';
  const match = /^(Work|Short break|Long break), (?:(\d+):)?(\d+):(\d\d) left$/.exec(label);
  if (!match) throw new Error(`Unexpected countdown label: ${label}`);
  const [, phase, h, m, s] = match;
  return { phase: phase!, seconds: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) };
}

/** Waits until the countdown shows `phase` with about `seconds` left; the clock runs on meanwhile. */
async function expectCountdown(ui: Bar, phase: string, seconds: number, slack = 5) {
  await expect(ui.countdown).toHaveAccessibleName(new RegExp(`^${phase}, `));
  const shown = await readCountdown(ui.countdown);
  expect(shown.seconds, `${phase} countdown`).toBeLessThanOrEqual(seconds);
  expect(shown.seconds, `${phase} countdown`).toBeGreaterThanOrEqual(seconds - slack);
}

async function startTimer(ui: Bar, description: string) {
  await ui.description.fill(description);
  await ui.start.click();
  await expect(ui.pause).toBeVisible();
}

/** The completed work phases this device counted, from its stored cycle. */
async function completedCount(page: Page): Promise<number> {
  const me = await (await page.request.get('/api/v9/me')).json() as { id: number };
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? '{"completed":0}') as { completed: number }).completed, `tokkl.pomodoro.${me.id}`);
}

test('the bell is a same-origin MP3', async ({ page }) => {
  await login(page);
  const response = await page.request.get(BELL);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('audio/mpeg');
  expect((await response.body()).byteLength).toBeGreaterThan(1000);
});

test('the built app serves each transition sound as the committed WAV', async ({ page }) => {
  await login(page);
  for (const name of TRANSITIONS) {
    const file = `pomodoro-${name}.wav`;
    const response = await page.request.get(`/sounds/${file}`);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['content-type'], file).toBe('audio/wav');
    expect((await response.body()).equals(readFileSync(new URL(`../packages/web/public/sounds/${file}`, import.meta.url))), file).toBe(true);
  }
});

test('with stop-at-end on, the end of a work phase rings, pauses the entry and runs the break until Resume', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Focused work');
  await expectCountdown(ui, 'Work', WORK);
  await page.clock.fastForward(60_000);
  await expectCountdown(ui, 'Work', WORK - 60);
  expect(await ui.plays()).toBe(0);
  await expect(ui.banner).toHaveCount(0);

  await page.clock.fastForward(60_000);
  await expect(ui.banner).toHaveText(/Work phase over\. Time for a break\./);
  await expect(ui.resume).toBeVisible();
  await expect.poll(() => api.current()).toBeNull();
  expect(await ui.plays()).toBe(1);
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => window.bellPlays)).toEqual([`${origin}${BELL}`]);
  await expectCountdown(ui, 'Short break', SHORT);
  // The banner stays while the break runs.
  await page.clock.fastForward(30_000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  await expectCountdown(ui, 'Short break', SHORT - 30);

  await page.clock.fastForward(30_000);
  await expect(ui.banner).toHaveText(/Short break over\. Back to work\./);
  await expect.poll(() => ui.plays()).toBe(2);
  // Paused through the break's end, the next work phase waits for Resume.
  await expect(ui.countdown).toHaveCount(0);
  await expect(ui.resume).toBeVisible();
  await ui.dismiss.click();
  await expect(ui.banner).toHaveCount(0);

  await page.clock.fastForward(20_000);
  await ui.resume.click();
  await expect(ui.pause).toBeVisible();
  await expectCountdown(ui, 'Work', WORK);
  // The server saw seconds of the faked work phase, so the paused entry rounded to zero and went
  // to the trash.
  const entries = await api.entries();
  expect(entries.map((entry) => entry.description)).toEqual(['Focused work']);
  expect((await api.trash()).map((entry) => entry.description)).toEqual(['Focused work']);
  expect(await ui.plays()).toBe(2);
});

test('with stop-at-end off, the entry keeps running beside the break and the next phase starts at the break end', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: false });
  await startTimer(ui, 'Long stretch');
  const running = await api.current();

  await page.clock.fastForward(WORK * 1000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  expect(await ui.plays()).toBe(1);
  await expectCountdown(ui, 'Short break', SHORT);
  await expect(ui.runningClock).toBeVisible();
  await expect(ui.pause).toBeVisible();
  expect((await api.current())?.id).toBe(running!.id);

  // Jump 20 s past the break's end: the work phase counts from the break's end, not from now.
  await page.clock.fastForward(SHORT * 1000 + 20_000);
  await expect(ui.banner).toHaveText(/Short break over/);
  await expect.poll(() => ui.plays()).toBe(2);
  await expectCountdown(ui, 'Work', WORK - 20);
  expect((await api.current())?.id).toBe(running!.id);
});

test('a pause freezes the work countdown and Resume continues the remaining time', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Interrupted');
  await page.clock.fastForward(45_000);
  await ui.pause.click();
  await expect(ui.resume).toBeVisible();
  await expectCountdown(ui, 'Work', WORK - 45);
  const frozen = (await readCountdown(ui.countdown)).seconds;

  // Paused well past the work length, the phase neither moves nor ends.
  await page.clock.fastForward(5 * 60_000);
  expect((await readCountdown(ui.countdown)).seconds).toBe(frozen);
  expect(await ui.plays()).toBe(0);
  await expect(ui.banner).toHaveCount(0);

  await ui.resume.click();
  await expect(ui.pause).toBeVisible();
  await expectCountdown(ui, 'Work', frozen);
  await page.clock.fastForward(frozen * 1000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  expect(await ui.plays()).toBe(1);
  await expect(ui.resume).toBeVisible();
});

test('Continue during a work phase begins a fresh phase for the other entry and does not count the old one', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: true });
  await api.createEntry({
    description: 'Earlier work', start: new Date(Date.now() - 3_600_000).toISOString(), stop: new Date(Date.now() - 3_000_000).toISOString(),
  });
  await page.reload();
  await startTimer(ui, 'First task');
  await page.clock.fastForward(90_000);
  await expectCountdown(ui, 'Work', WORK - 90);

  await page.locator('.entry-line', { has: page.locator('input[value="Earlier work"]') }).first()
    .getByRole('button', { name: 'Continue this entry' }).click();
  await expect(ui.description).toHaveValue('Earlier work');
  await expect.poll(async () => (await readCountdown(ui.countdown)).seconds).toBeGreaterThanOrEqual(WORK - 5);
  // The old phase would have ended here.
  await page.clock.fastForward(60_000);
  await expectCountdown(ui, 'Work', WORK - 60);
  await expect(ui.pause).toBeVisible();
  expect(await ui.plays()).toBe(0);
  expect(await completedCount(page)).toBe(0);

  await page.clock.fastForward(60_000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  await expect(ui.resume).toBeVisible();
  expect(await ui.plays()).toBe(1);
  expect(await completedCount(page)).toBe(1);
});

test('a pause whose stop answers after the work length freezes the work time at the pause', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Slow network');
  await page.clock.fastForward(60_000);
  const held = await holdNextStop(page);
  await ui.pause.click();
  await held.sent;
  // The answer arrives 70 seconds later, past the two-minute work length.
  await page.clock.fastForward(70_000);
  held.release();

  await expect(ui.resume).toBeVisible();
  await expectCountdown(ui, 'Work', WORK - 60);
  expect(await ui.plays()).toBe(0);
  await expect(ui.banner).toHaveCount(0);
  expect(await completedCount(page)).toBe(0);
});

test('Stop abandons the work phase without counting it, and the next start begins a fresh phase', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: false, longBreakEvery: 3 });
  await startTimer(ui, 'First');
  await page.clock.fastForward(WORK * 1000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  expect(await completedCount(page)).toBe(1);

  // The short break ends with the timer running, so the second phase starts; Stop abandons it.
  await page.clock.fastForward(SHORT * 1000 + 30_000);
  await expectCountdown(ui, 'Work', WORK - 30);
  await ui.stop.click();
  await expect(ui.start).toBeVisible();
  await expect(ui.countdown).toHaveCount(0);
  expect(await completedCount(page)).toBe(1);

  await page.clock.fastForward(10_000);
  await startTimer(ui, 'Second');
  await expectCountdown(ui, 'Work', WORK);
  await page.clock.fastForward(WORK * 1000);
  // Two completed phases out of three: still a short break.
  await expectCountdown(ui, 'Short break', SHORT);
  expect(await completedCount(page)).toBe(2);
  expect(await ui.plays()).toBe(3);
});

test('a long break follows every Nth work phase, and its end rings', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: false, longBreakEvery: 2 });
  await startTimer(ui, 'Cycle');
  await page.clock.fastForward(WORK * 1000);
  await expectCountdown(ui, 'Short break', SHORT);
  await page.clock.fastForward(SHORT * 1000);
  await expectCountdown(ui, 'Work', WORK);
  await page.clock.fastForward(WORK * 1000);
  await expectCountdown(ui, 'Long break', LONG);
  await expect(ui.banner).toHaveText(/Work phase over/);
  expect(await ui.plays()).toBe(3);

  await page.clock.fastForward(LONG * 1000);
  await expect(ui.banner).toHaveText(/Long break over\. Back to work\./);
  await expect.poll(() => ui.plays()).toBe(4);
  await expectCountdown(ui, 'Work', WORK);
  expect(await completedCount(page)).toBe(0);
});

test('a rejected play() raises no page error and the banner still shows', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: true, rejectPlay: true });
  await startTimer(ui, 'Muted tab');
  await page.clock.fastForward(WORK * 1000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  await expect(ui.resume).toBeVisible();
  expect(await ui.plays()).toBe(1);
  // The runtimeErrors fixture fails the test on any page error or console error.
});

test('with notifications allowed, a phase end in a hidden tab shows one notification that a click closes, and a visible tab shows none', async ({ page, users }) => {
  const { ui } = await open(page, users, { stopAtEnd: false, notifications: { permission: 'granted' } });
  await startTimer(ui, 'Background work');
  await setHidden(page, true);

  await page.clock.fastForward(WORK * 1000);
  await expect.poll(() => shownNotifications(page)).toEqual([{ title: 'Work phase over', body: 'Time for a break.', closed: false }]);
  expect(await ui.plays()).toBe(1);
  // The tick that follows the end shows no second one.
  await page.clock.fastForward(5_000);
  expect(await shownNotifications(page)).toHaveLength(1);

  expect(await focusCalls(page)).toBe(0);
  await clickNotification(page, 0);
  expect(await focusCalls(page)).toBe(1);
  expect((await shownNotifications(page))[0]!.closed).toBe(true);

  await page.clock.fastForward(SHORT * 1000);
  await expect.poll(() => shownNotifications(page)).toHaveLength(2);
  expect((await shownNotifications(page))[1]).toEqual({ title: 'Short break over', body: 'Back to work.', closed: false });

  // Back in view, the banner and the bell cover the next phase end.
  await setHidden(page, false);
  await page.clock.fastForward(WORK * 1000);
  await expect(ui.banner).toHaveText(/Work phase over/);
  await expect.poll(() => ui.plays()).toBe(3);
  expect(await shownNotifications(page)).toHaveLength(2);
  // Nothing asks for permission on load or at a phase end.
  expect(await permissionRequests(page)).toBe(0);
});

for (const [name, notifications] of [
  ['notifications not asked for yet', { permission: 'default' }],
  ['notifications denied', { permission: 'denied' }],
  ['no Notification in the browser', { support: 'missing' }],
  ['a Notification constructor that throws', { permission: 'granted', support: 'throws' }],
  ['a page served over plain HTTP', { permission: 'granted', secure: false }],
] as const satisfies readonly (readonly [string, NotificationSetup])[]) {
  test(`with ${name}, a phase end in a hidden tab shows no notification and raises no page error`, async ({ page, users }) => {
    const { ui } = await open(page, users, { stopAtEnd: false, notifications });
    await startTimer(ui, 'Background work');
    await setHidden(page, true);
    await page.clock.fastForward(WORK * 1000);
    await expect(ui.banner).toHaveText(/Work phase over/);
    expect(await ui.plays()).toBe(1);
    expect(await shownNotifications(page)).toEqual([]);
    expect(await permissionRequests(page)).toBe(0);
    // The runtimeErrors fixture fails the test on any page error or console error.
  });
}

test('phases that end while another page is open ring there, pause the entry, and do not ring again back on the timer', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Reading reports');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const banner = page.getByRole('status').filter({ hasText: /phase over|break over/ });
  await nav.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(ui.timer).toHaveCount(0);

  await page.clock.fastForward(WORK * 1000);
  await expect(banner).toHaveText(/Work phase over\. Time for a break\./);
  await expect.poll(() => ui.plays()).toBe(1);
  await expect.poll(() => api.current()).toBeNull();

  await page.clock.fastForward(SHORT * 1000);
  await expect(banner).toHaveText(/Short break over\. Back to work\./);
  await expect.poll(() => ui.plays()).toBe(2);

  await nav.getByRole('link', { name: 'Timer' }).click();
  await expect(ui.resume).toBeVisible();
  await expect(ui.banner).toHaveText(/Short break over/);
  await expect(ui.countdown).toHaveCount(0);
  expect(await ui.plays()).toBe(2);

  // The pause on the other page left the same chain the Pause button does: Resume clones the entry.
  await ui.dismiss.click();
  await expect(banner).toHaveCount(0);
  await ui.resume.click();
  await expect(ui.pause).toBeVisible();
  await expectCountdown(ui, 'Work', WORK);
  // The server saw seconds of the faked work phase, so the paused entry rounded to zero and went
  // to the trash.
  const entries = await api.entries();
  expect(entries.map((entry) => entry.description)).toEqual(['Reading reports']);
  expect(entries.filter((entry) => entry.stop === null)).toHaveLength(1);
  expect((await api.trash()).map((entry) => entry.description)).toEqual(['Reading reports']);
  expect(await ui.plays()).toBe(2);
});

test('Stop pressed while the end of a work phase is pausing the entry sends no second stop', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Stopped at the bell');
  // The jump also fires the 30-second poll of the running entry; on a slow network it answers late too.
  const held = await holdNextStop(page, /\/api\/v9\/me\/time_entries\/current/);
  await page.clock.fastForward(WORK * 1000);
  await held.sent;
  await ui.stop.click();
  held.release();

  await expect(ui.start).toBeVisible();
  await expect(ui.resume).toHaveCount(0);
  expect(held.stops.count).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await api.current()).toBeNull();
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('tokkl.pauseChain.')))).toEqual([]);
  // The work phase ended before Stop, so its break runs on.
  await expect(ui.banner).toHaveText(/Work phase over/);
  await expectCountdown(ui, 'Short break', SHORT);
  expect(await ui.plays()).toBe(1);
});

test('a switch-off whose save fails keeps the cycle, and a confirmed one clears it', async ({ page, users, runtimeErrors }) => {
  const { ui } = await open(page, users, { stopAtEnd: true });
  await startTimer(ui, 'Settings detour');
  await page.clock.fastForward(60_000);
  await expectCountdown(ui, 'Work', WORK - 60);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const preferences = page.getByRole('form', { name: 'Preferences' });
  const enabled = preferences.getByRole('group', { name: 'Pomodoro' }).getByRole('checkbox', { name: 'Enable the Pomodoro cycle' });
  const save = preferences.getByRole('button', { name: 'Save' });
  const cycleKey = async () => {
    const me = await (await page.request.get('/api/v9/me')).json() as { id: number };
    return page.evaluate((key) => window.localStorage.getItem(key), `tokkl.pomodoro.${me.id}`);
  };

  // The save fails after a while, so the optimistic switch-off shows first and then rolls back.
  runtimeErrors.allowResponse({ status: 500, method: 'POST', path: /^\/api\/v9\/me\/preferences$/, reason: 'the switch-off save fails on purpose' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/v9\/me\/preferences$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '"Server error"' });
  });
  await nav.getByRole('link', { name: 'Settings' }).click();
  await enabled.uncheck();
  const failed = page.waitForResponse((response) => response.request().method() === 'POST' && /\/me\/preferences$/.test(response.url()));
  await save.click();
  await expect.poll(cycleKey).not.toBeNull();
  release();
  await failed;
  await nav.getByRole('link', { name: 'Timer' }).click();
  await expectCountdown(ui, 'Work', WORK - 60);
  expect(await cycleKey()).not.toBeNull();

  // A switch-off the server confirms drops the cycle; turning it on again starts a fresh phase.
  await page.unroute(/\/api\/v9\/me\/preferences$/);
  await nav.getByRole('link', { name: 'Settings' }).click();
  await enabled.uncheck();
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && /\/me\/preferences$/.test(response.url()) && response.ok());
  await save.click();
  await saved;
  await expect.poll(cycleKey).toBeNull();
  await enabled.check();
  const again = page.waitForResponse((response) => response.request().method() === 'POST' && /\/me\/preferences$/.test(response.url()) && response.ok());
  await save.click();
  await again;
  await nav.getByRole('link', { name: 'Timer' }).click();
  await expectCountdown(ui, 'Work', WORK);
});

test('with the Pomodoro off, the timer bar shows no countdown, banner or bell', async ({ page, users }) => {
  const { api, ui } = await open(page, users, { stopAtEnd: true, enabled: false });
  await startTimer(ui, 'Plain timer');
  await page.clock.fastForward(WORK * 1000 + SHORT * 1000);
  await expect(ui.runningClock).toBeVisible();
  await expect(ui.countdown).toHaveCount(0);
  await expect(ui.banner).toHaveCount(0);
  expect(await ui.plays()).toBe(0);
  expect(await api.current()).not.toBeNull();
  expect(await completedCount(page)).toBe(0);
});
