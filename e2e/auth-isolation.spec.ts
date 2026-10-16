import type { Page } from '@playwright/test';
import { expect, test, type TestData } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';

// TT-0142: two accounts on one server and one browser. User A (the setup admin) leaves data,
// settings and a theme behind; after A logs out, user B logs in on the same browser context and
// must find none of it, and A's workspace stays closed to B's session by URL and by API.

const CSRF = { 'X-Tokkl-CSRF': '1' };
const A_ENTRY = 'A private: acquisition shortlist';
const A_PROJECT = 'A private: Project Falcon';
const B_ENTRY = 'B own: weekly review';
const B_PROJECT = 'B own: Garden plan';

function hoursAgo(hours: number, length = 1): { start: string; stop: string } {
  const start = new Date(Date.now() - hours * 3_600_000);
  return { start: start.toISOString(), stop: new Date(start.getTime() + length * 3_600_000).toISOString() };
}

async function seed(user: TestData, project: string, entry: string): Promise<{ projectId: number; entryId: number }> {
  const { id: projectId } = await user.createProject({ name: project });
  const { id: entryId } = await user.createEntry({ description: entry, project_id: projectId, ...hoursAgo(3) });
  return { projectId, entryId };
}

async function expectAbsent(page: Page, ...texts: string[]): Promise<void> {
  const html = await page.content();
  for (const text of texts) expect(html, `the page shows nothing of "${text}"`).not.toContain(text);
}

test('reset() on one account leaves the other account\'s entries and projects alone', async ({ data, users }) => {
  const b = await users.create();
  await seed(data, A_PROJECT, A_ENTRY);
  await seed(b, B_PROJECT, B_ENTRY);

  await b.reset();
  expect(await b.entries()).toEqual([]);
  expect(await b.projects()).toEqual([]);
  expect((await data.entries()).map((entry) => entry.description)).toEqual([A_ENTRY]);
  expect((await data.projects()).map((project) => project.name)).toEqual([A_PROJECT]);

  await seed(b, B_PROJECT, B_ENTRY);
  await data.reset();
  expect(await data.entries()).toEqual([]);
  expect((await b.entries()).map((entry) => entry.description)).toEqual([B_ENTRY]);
  expect((await b.projects()).map((project) => project.name)).toEqual([B_PROJECT]);
});

test('after A logs out, B logs in on the same browser and sees none of A\'s data, settings or theme', async ({ page, data, users }) => {
  const b = await users.create({ fullname: 'Second Person' });
  await seed(data, A_PROJECT, A_ENTRY);
  await data.savePreferences({ timeofday_format: 'h:mm A', theme: 'dark' });
  await seed(b, B_PROJECT, B_ENTRY);

  // A's session shows A's data in A's theme.
  await login(page);
  const firstEntry = page.locator('.entry-line').first().getByLabel('Description');
  await expect(firstEntry).toHaveValue(A_ENTRY);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await loginAs(page, b.account);
  await expect(firstEntry).toHaveValue(B_ENTRY);
  await expect(page.locator('.entry-line')).toHaveCount(1);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  await expectAbsent(page, A_ENTRY, A_PROJECT, data.account.email);

  // A reload starts from the cached theme, which must not be A's either.
  await page.reload();
  await expect(firstEntry).toHaveValue(B_ENTRY);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('main').getByText(B_PROJECT)).toBeVisible();
  await expectAbsent(page, A_PROJECT, A_ENTRY);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('Email')).toHaveValue(b.account.email);
  await expect(page.getByLabel('Full name')).toHaveValue('Second Person');
  await expect(page.getByLabel('Theme')).toHaveValue('system');
  await expect(page.getByLabel('Time format')).toHaveValue('H:mm');
  await expectAbsent(page, data.account.email, A_PROJECT);
});

test('B cannot open A\'s data by URL or by API request with B\'s session', async ({ page, data, users, runtimeErrors }) => {
  const b = await users.create();
  const a = await seed(data, A_PROJECT, A_ENTRY);
  const aWorkspace = `/api/v9/workspaces/${data.workspaceId}`;

  // A's detailed report, filtered on A's project, lists A's entry for A...
  const day = new Date(Date.now() - 3 * 3_600_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const reportUrl = `/reports?from=${day}&to=${day}&tab=detailed&projects=${a.projectId}`;
  await login(page);
  await page.goto(reportUrl);
  await expect(page.getByRole('main').getByText(A_ENTRY)).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // ...and the same link finds nothing of A's once B is signed in.
  await loginAs(page, b.account);
  await page.goto(reportUrl);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectAbsent(page, A_ENTRY, A_PROJECT);

  // Opening A's project in the address bar gets the API's refusal, not the project.
  const projectPath = `${aWorkspace}/projects/${a.projectId}`;
  runtimeErrors.allowResponse({
    status: 403, method: 'GET', path: new RegExp(`^${projectPath}$`), reason: "B's session opens A's project by URL",
  });
  const opened = await page.goto(projectPath);
  expect(opened?.status()).toBe(403);
  await expectAbsent(page, A_PROJECT);

  // Direct requests with the browser's session (B's cookie) are refused for reads and writes.
  const reads = ['', '/projects', `/projects/${a.projectId}`, '/clients', '/tags', '/users'];
  for (const path of reads) {
    const response = await page.request.get(`${aWorkspace}${path}`);
    expect(response.status(), `GET ${aWorkspace}${path}`).toBe(403);
    expect(await response.text()).not.toContain(A_PROJECT);
  }
  const writes = [
    page.request.post(`${aWorkspace}/projects`, { headers: CSRF, data: { name: 'Planted by B' } }),
    page.request.put(`${aWorkspace}/time_entries/${a.entryId}`, { headers: CSRF, data: { description: 'Changed by B' } }),
    page.request.delete(`${aWorkspace}/time_entries/${a.entryId}`, { headers: CSRF }),
    page.request.delete(`${aWorkspace}/projects/${a.projectId}`, { headers: CSRF }),
  ];
  for (const write of writes) expect((await write).status()).toBe(403);

  // B's own lists never include A's rows.
  const own = await (await page.request.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01')).json() as Array<{ id: number }>;
  expect(own.map((entry) => entry.id)).not.toContain(a.entryId);

  // A's data is untouched.
  expect((await data.entries()).map((entry) => entry.description)).toEqual([A_ENTRY]);
  expect((await data.projects()).map((project) => project.name)).toEqual([A_PROJECT]);
});
