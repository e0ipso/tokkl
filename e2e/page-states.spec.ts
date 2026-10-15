import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { login } from './helpers.ts';
import { EntityApi } from './entity-tests-helpers.ts';
import { ACCOUNT_TIME_ZONE, accountTime, recentDate } from './transfer-tests-helpers.ts';

// TT-0085: content that has not arrived is an aria-busy region with a status label, and a failed
// load is an alert that says what failed and offers "Try again". TT-0112: report tabs and project
// tasks use the same states. TT-0086: empty lists say what to do next, and the empty entry list
// can start a timer or switch to manual mode.

/** Retries of a 5xx answer: TanStack Query tries three times, waiting 1 s and then 2 s. */
const AFTER_RETRIES = { timeout: 10_000 };

/**
 * Answers every request to `path` with 503 "Server unavailable" until the returned function is
 * called. Other methods and paths go through untouched.
 */
async function failRequests(page: Page, method: 'GET' | 'POST', path: RegExp): Promise<() => void> {
  let failing = true;
  await page.route((url) => path.test(url.pathname), (route) => (failing && route.request().method() === method
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '"Server unavailable"' })
    : route.fallback()));
  return () => { failing = false; };
}

test('the app shows a busy splash while it starts and a Try again alert when the server is unreachable', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 503, method: 'GET', path: /^\/api\/v9\/me$/, reason: 'the scenario fakes an unreachable server' });
  await login(page);

  // Hold the first /me request so the splash stays up, then fail it and its retries.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const recover = await failRequests(page, 'GET', /^\/api\/v9\/me$/);
  await page.route('**/api/v9/me', async (route) => {
    await held;
    await route.fallback();
  }, { times: 1 });
  await page.reload();

  const splash = page.locator('.splash');
  await expect(splash.locator('[aria-busy="true"]').getByRole('status')).toHaveText('Loading…');
  await expect(splash.getByRole('img', { name: 'Tokkl' })).toBeVisible();
  release();
  const alert = splash.getByRole('alert');
  await expect(alert).toContainText("Can't reach the server: Server unavailable", AFTER_RETRIES);
  await expect(splash.locator('[aria-busy="true"]')).toHaveCount(0);

  recover();
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
  await expect(splash).toHaveCount(0);
});

interface FailedLoad {
  name: string;
  method: 'GET' | 'POST';
  path: RegExp;
  /** Runs after login: seeds what the view needs, opens it and says where the alert and the recovered content appear. */
  open: (page: Page) => Promise<{ scope: Locator; recovered: Locator }>;
  message: string;
}

const FAILED_LOADS: FailedLoad[] = [
  {
    name: 'the entry list',
    method: 'GET',
    path: /^\/api\/v9\/me\/time_entries$/,
    open: async (page) => {
      await page.reload();
      return { scope: page.locator('main'), recovered: page.getByText('No time entries in this period') };
    },
    message: 'Could not load time entries: Server unavailable',
  },
  {
    name: 'the week calendar',
    method: 'GET',
    path: /^\/api\/v9\/me\/time_entries$/,
    open: async (page) => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
      await (await EntityApi.open(page)).createEntry({ description: 'Calendar check', start: accountTime(today, '10:00:00'), stop: accountTime(today, '11:00:00') });
      await page.getByRole('button', { name: 'Calendar', exact: true }).click();
      return { scope: page.locator('main'), recovered: page.getByRole('group', { name: /^Calendar check/ }) };
    },
    message: 'Could not load this week: Server unavailable',
  },
  {
    name: 'the projects page',
    method: 'GET',
    path: /^\/api\/v9\/workspaces\/\d+\/projects$/,
    open: async (page) => {
      await page.goto('/projects');
      return { scope: page.locator('main'), recovered: page.getByText('No projects yet') };
    },
    message: 'Could not load projects: Server unavailable',
  },
  {
    name: 'the tasks of a project',
    method: 'GET',
    path: /^\/api\/v9\/workspaces\/\d+\/projects\/\d+\/tasks$/,
    open: async (page) => {
      await (await EntityApi.open(page)).createProject({ name: 'Platform' });
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' }).click();
      await page.getByRole('button', { name: 'Edit Platform' }).click();
      const tasks = page.getByRole('dialog', { name: 'Edit project' }).getByRole('region', { name: 'Tasks' });
      return { scope: tasks, recovered: tasks.getByText('No tasks yet.') };
    },
    message: 'Could not load tasks: Server unavailable',
  },
  {
    name: 'the weekly report tab',
    method: 'POST',
    path: /^\/api\/app\/report\/weekly$/,
    open: async (page) => {
      const day = recentDate();
      await (await EntityApi.open(page)).createEntry({ description: 'Weekly', start: accountTime(day, '09:00:00'), stop: accountTime(day, '10:00:00') });
      await page.goto(`/reports?from=${day}&to=${day}&tab=weekly`);
      return { scope: page.locator('main'), recovered: page.locator('.weekly-table') };
    },
    message: "Couldn't load the weekly report: Server unavailable",
  },
];

for (const load of FAILED_LOADS) {
  test(`${load.name} shows a Try again alert when it fails to load, then recovers`, async ({ page, runtimeErrors }) => {
    runtimeErrors.allowResponse({ status: 503, method: load.method, path: load.path, reason: 'the scenario fakes a failed load' });
    await login(page);
    const recover = await failRequests(page, load.method, load.path);
    const { scope, recovered } = await load.open(page);

    const alert = scope.getByRole('alert').filter({ hasText: load.message });
    await expect(alert).toBeVisible(AFTER_RETRIES);
    await expect(recovered).toHaveCount(0);

    recover();
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(recovered).toBeVisible();
  });
}

test('the entry list stays on screen and is marked busy while it refetches', async ({ page }) => {
  const day = recentDate();
  await login(page);
  await (await EntityApi.open(page)).createEntry({ description: 'Kept on screen', start: accountTime(day, '09:00:00'), stop: accountTime(day, '10:00:00') });
  await page.reload();
  const row = page.locator('.entry-line', { has: page.locator('input[value="Kept on screen"]') });
  await expect(row).toBeVisible();
  const busy = page.locator('[aria-busy="true"]', { has: row });
  await expect(busy).toHaveCount(0);

  // Focus refetches the list; hold that request so the busy state can be read.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = () => {};
  const refetched = new Promise<void>((resolve) => { requested = resolve; });
  await page.route((url) => url.pathname === '/api/v9/me/time_entries', async (route) => {
    requested();
    await held;
    await route.fallback();
  }, { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refetched;
  await expect(busy).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  release();
  await expect(busy).toHaveCount(0);
  await expect(row).toBeVisible();
});

test('the entry list keeps its rows and is marked busy while Show more days loads', async ({ page }) => {
  // TT-0116: the wider range used to replace the whole list with "Loading entries…".
  const day = recentDate();
  // 20 days ago in the account timezone: outside the first 14 days, inside the next 14.
  const older = new Intl.DateTimeFormat('en-CA', { timeZone: ACCOUNT_TIME_ZONE }).format(new Date(Date.now() - 20 * 24 * 3600 * 1000));
  await login(page);
  const entities = await EntityApi.open(page);
  await entities.createEntry({ description: 'Kept on screen', start: accountTime(day, '09:00:00'), stop: accountTime(day, '10:00:00') });
  await entities.createEntry({ description: 'Older day', start: accountTime(older, '09:00:00'), stop: accountTime(older, '10:00:00') });
  await page.reload();
  const row = page.locator('.entry-line', { has: page.locator('input[value="Kept on screen"]') });
  const olderRow = page.locator('.entry-line', { has: page.locator('input[value="Older day"]') });
  await expect(row).toBeVisible();
  await expect(olderRow).toHaveCount(0);
  const busy = page.locator('[aria-busy="true"]', { has: row });

  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = () => {};
  const widened = new Promise<void>((resolve) => { requested = resolve; });
  await page.route((url) => url.pathname === '/api/v9/me/time_entries', async (route) => {
    requested();
    await held;
    await route.fallback();
  }, { times: 1 });
  await page.getByRole('button', { name: 'Show 14 more days' }).click();
  await widened;
  await expect(busy).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading entries…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  release();
  await expect(olderRow).toBeVisible();
  await expect(row).toBeVisible();
  await expect(busy).toHaveCount(0);
});

test('the empty entry list offers Manual mode and Start timer', async ({ page }) => {
  await login(page);
  const timer = page.getByRole('region', { name: 'Timer' });
  const empty = page.locator('.empty-state', { hasText: 'No time entries in this period' });
  await expect(empty).toContainText('or switch to manual mode to log time you already worked.');

  await empty.getByRole('button', { name: 'Manual mode' }).click();
  await expect(timer.getByLabel('Date')).toBeVisible();
  await expect(timer.getByRole('button', { name: 'Manual mode' })).toHaveAttribute('aria-pressed', 'true');
  // Already in manual mode, the empty state points at the fields instead of the switch.
  await expect(empty.getByRole('button', { name: 'Manual mode' })).toHaveCount(0);
  await expect(empty).toContainText('or fill in the times above to log time you already worked.');

  // Start timer leaves manual mode and starts the clock.
  await empty.getByRole('button', { name: 'Start timer' }).click();
  await expect(timer.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await expect(timer.getByLabel('Date')).toHaveCount(0);
  await expect(timer.getByLabel('Description')).toBeFocused();
});

test('empty management pages and the trash say they are empty', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [link, title] of [
    ['Projects', 'No projects yet'],
    ['Clients', 'No clients yet'],
    ['Tags', 'No tags yet'],
    ['Trash', 'The trash is empty'],
  ] as const) {
    await nav.getByRole('link', { name: link }).click();
    await expect(page.locator('main .empty-state-title')).toHaveText(title);
  }
});
