import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, request, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { PHONE } from '../e2e/mobile-tests-helpers.ts';
import { RuntimeErrors } from '../e2e/runtime-errors.ts';
import { NOW, TIME_ZONE, screenshotExport } from './screenshots-data.ts';

// Writes the README images in docs/screenshots. Run it with `npm run screenshots`, which builds
// the web app first and uses scripts/screenshots.config.ts.

const OUT_DIR = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const CSRF = { 'X-Timetrack-CSRF': '1' };
const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const MOBILE: BrowserContextOptions = { ...PHONE, deviceScaleFactor: 2 };

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let session: Awaited<ReturnType<APIRequestContext['storageState']>>;

async function ok<T>(response: Promise<APIResponse>): Promise<T> {
  const answer = await response;
  if (!answer.ok()) throw new Error(`${answer.url()} answered ${answer.status()}: ${await answer.text()}`);
  return answer.json() as Promise<T>;
}

function savePreferences(preferences: Record<string, unknown>): Promise<unknown> {
  return ok(api.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
}

test.beforeAll(async ({ baseURL }) => {
  api = await request.newContext({ baseURL });
  await ok(api.post('/api/app/setup', {
    data: { setup_code: 'SCREENSHOTS-SETUP-CODE', email: 'demo@example.com', password: 'screenshots password', fullname: 'Demo User', timezone: TIME_ZONE },
  }));
  const result = await ok<{ errors: unknown[]; time_entries: number }>(api.post('/api/app/import/json', {
    headers: { ...CSRF, 'Content-Type': 'application/json' },
    data: JSON.stringify(screenshotExport()),
  }));
  expect(result.errors, 'the screenshot data restores without errors').toEqual([]);

  const me = await ok<{ default_workspace_id: number }>(api.get('/api/v9/me'));
  const projects = await ok<Array<{ id: number; name: string }>>(api.get(`/api/v9/workspaces/${me.default_workspace_id}/projects`));
  const projectId = (name: string) => projects.find((project) => project.name === name)!.id;
  await savePreferences({
    theme: 'light',
    timerView: 'list',
    favorites: [
      { description: 'Planning', project_id: projectId('Roadmap'), task_id: null, tags: ['ux', 'ops'], billable: false },
      { description: 'Code review', project_id: projectId('Billing API'), task_id: null, tags: ['review'], billable: true },
    ],
  });
  session = await api.storageState();
  mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await api.dispose();
});

/** Opens a page with the given device settings, the demo session and the browser clock at NOW. */
async function openPage(browser: Browser, options: BrowserContextOptions): Promise<{ page: Page; errors: RuntimeErrors }> {
  const context = await browser.newContext({ ...options, storageState: session });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  return { page, errors: new RuntimeErrors(page) };
}

/** Loads `path`, waits for `ready`, the fonts and the network, then saves docs/screenshots/<name>.png. */
async function capture(page: Page, path: string, name: string, ready: (page: Page) => Locator): Promise<void> {
  await page.goto(path);
  await expect(ready(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `${OUT_DIR}${name}.png`, animations: 'disabled', caret: 'hide' });
}

const runningTimer = (page: Page) => page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Stop timer' });
const calendar = (page: Page) => page.locator('.calendar-grid').getByText('Release checklist').first();
const summary = (page: Page) => page.getByRole('region', { name: 'Breakdown' }).getByText('Billing API').first();
const detailed = (page: Page) => page.getByRole('tabpanel').getByText('Webhook retries').first();
const weekly = (page: Page) => page.getByRole('tabpanel').getByText('Mobile app').first();
const projectsList = (page: Page) => page.getByRole('main').getByText('Billing API').first();

test('desktop', async ({ browser }, testInfo) => {
  const { page, errors } = await openPage(browser, DESKTOP);
  await savePreferences({ timerView: 'list' });
  await capture(page, '/', 'desktop-timer', runningTimer);
  await savePreferences({ timerView: 'calendar' });
  await capture(page, '/', 'desktop-calendar', calendar);
  await capture(page, '/reports?range=last_30', 'desktop-reports-summary', summary);
  await capture(page, '/reports?range=last_30&tab=detailed', 'desktop-reports-detailed', detailed);
  await capture(page, '/reports?range=last_30&tab=weekly', 'desktop-reports-weekly', weekly);
  await errors.verify(testInfo);
  await page.context().close();
});

test('mobile', async ({ browser }, testInfo) => {
  const { page, errors } = await openPage(browser, MOBILE);
  await savePreferences({ timerView: 'list' });
  await capture(page, '/', 'mobile-timer', runningTimer);
  await savePreferences({ timerView: 'calendar' });
  await capture(page, '/', 'mobile-calendar', calendar);
  await capture(page, '/reports?range=last_30', 'mobile-reports', summary);
  await savePreferences({ timerView: 'list' });
  await errors.verify(testInfo);
  await page.context().close();
});

// Runs last because it stops the timer. Project totals count a running entry up to SQLite's
// unixepoch('now'), which the frozen Date in the server cannot reach, so the Tracked column would
// change on every run. Stopped through the API, the entry ends at NOW.
test('desktop projects', async ({ browser }, testInfo) => {
  const running = await ok<{ id: number; workspace_id: number }>(api.get('/api/v9/me/time_entries/current'));
  await ok(api.patch(`/api/v9/workspaces/${running.workspace_id}/time_entries/${running.id}/stop`, { headers: CSRF }));
  const { page, errors } = await openPage(browser, DESKTOP);
  await capture(page, '/projects', 'desktop-projects', projectsList);
  await errors.verify(testInfo);
  await page.context().close();
});
