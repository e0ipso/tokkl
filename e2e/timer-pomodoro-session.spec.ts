import type { Page } from '@playwright/test';
import { expect, test } from './admin-tests-helpers.ts';
import { login, loginAs } from './helpers.ts';
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
      version: 1, id: 'restored-session', revision: 3, ending: false,
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
