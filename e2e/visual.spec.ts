import type { Locator, Page } from '@playwright/test';
import { expect, test, type Account, type ExtraUsers, type TestData } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE } from './mobile-tests-helpers.ts';
import { transferFixture } from './transfer-tests-helpers.ts';

// Screenshot baselines for the redesigned pages, in light and dark, on desktop and a phone. They
// guard the look of each page against CSS regressions. The PNGs sit in visual.spec.ts-snapshots/
// and are rendered by the pinned headless Chromium; refresh them after an intended change with
// `npx playwright test visual --update-snapshots` (see the README's Testing section).
//
// The data is e2e/fixtures-data/transfer/restore-full.json, which has no running entry. The
// browser clock is fixed at NOW, the day after the fixture's "Planning" entry, so the timer list,
// the calendar week and every relative date render the same on every run. Only the browser clock
// is fixed: the server keeps real time, which nothing on these pages shows except the admin
// page's created and expiry dates, which the shot masks.
//
// Settings is shot as a regular account, whose page has no Admin link; every other page
// is shot as the setup admin.

const CSRF = { 'X-Tokkl-CSRF': '1' };
/** Thursday 16 July 2026, 15:20 in Europe/Madrid (the config's timezone). */
const NOW = '2026-07-16T13:20:00.000Z';

const DEVICES = { desktop: {}, phone: PHONE } as const;
const SCHEMES = ['light', 'dark'] as const;

interface Capture {
  name: string;
  path: string;
  timerView?: 'list' | 'calendar';
  ready: (page: Page) => Locator;
  /** Signs in as this regular account, created through an invite, instead of the setup admin. */
  regularUser?: { email: string; fullname: string };
  /** Creates what the page shows beyond the restored fixture. */
  prepare?: (data: TestData, users: ExtraUsers) => Promise<void>;
  /** Parts that follow the server's real clock, masked in the shot. */
  mask?: (page: Page) => Locator[];
}

const PAGES: readonly Capture[] = [
  { name: 'timer-list', path: '/', timerView: 'list', ready: (page) => page.locator('.entry-list').getByRole('button', { name: 'Roadmap' }) },
  {
    name: 'timer-calendar',
    path: '/',
    timerView: 'calendar',
    // A phone shows only today, which has no entry; the strip's total for the "Planning" day shows the week has loaded.
    ready: (page) => page.locator('.calendar-grid').getByText('Planning').first()
      .or(page.getByRole('group', { name: 'Days of the week' }).getByRole('button', { name: 'Wed 15 Jul, 1:00:00' })),
  },
  {
    name: 'reports-summary',
    path: '/reports?from=2026-07-13&to=2026-07-19',
    ready: (page) => page.getByRole('region', { name: 'Breakdown' }).getByText('Roadmap').first(),
  },
  { name: 'projects', path: '/projects', ready: (page) => page.getByRole('main').getByText('Website').first() },
  {
    name: 'settings',
    path: '/settings',
    ready: (page) => page.getByRole('main').getByText('API token').first(),
    regularUser: { email: 'e2e-user@example.com', fullname: 'E2E User' },
  },
  {
    name: 'admin',
    path: '/admin',
    ready: (page) => page.locator('#invites').getByText('For the design team'),
    prepare: async (data, users) => {
      await users.create({ email: 'rita@example.com', fullname: 'Regular Rita' });
      await data.createInvite({ role: 'user', note: 'For the design team' });
    },
    mask: (page) => [page.locator('.admin-date')],
  },
];

async function post(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, { headers: CSRF, data });
  expect(response.ok(), `POST ${path} answered ${response.status()}`).toBe(true);
}

/** Logs in on the frozen clock and restores the fixture through the page's own session. */
async function seed(page: Page, timerView: Capture['timerView'], account?: Account): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW));
  if (account) await loginAs(page, account);
  else await login(page);
  const backup = transferFixture('restore-full.json');
  await post(page, '/api/app/import/json', JSON.parse(backup.buffer.toString('utf8')));
  // The shared fixture does not reset the theme; "system" lets colorScheme pick light or dark.
  await post(page, '/api/v9/me/preferences', { theme: 'system', timerView: timerView ?? 'list' });
}

/**
 * The API token card prints the server origin, whose port is E2E_PORT, in its curl example and
 * base URLs. Write a fixed origin in its place so the baseline does not depend on the port.
 */
async function pinOrigin(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const code of document.querySelectorAll('code')) {
      const text = code.textContent ?? '';
      if (text.includes(window.location.origin)) code.textContent = text.replaceAll(window.location.origin, 'http://127.0.0.1:8095');
    }
  });
}

for (const [device, deviceOptions] of Object.entries(DEVICES)) {
  for (const colorScheme of SCHEMES) {
    test.describe(`${device} ${colorScheme}`, () => {
      test.use({ ...deviceOptions, colorScheme, reducedMotion: 'reduce' });

      for (const capture of PAGES) {
        test(`${capture.name} matches its baseline`, async ({ page, data, users }) => {
          const regular = capture.regularUser ? await users.create(capture.regularUser) : null;
          await capture.prepare?.(data, users);
          await seed(page, capture.timerView, regular?.account);
          await page.goto(capture.path);
          await expect(capture.ready(page)).toBeVisible();
          await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await pinOrigin(page);
          // Full page, so the whole page is guarded. On the phone the fixed bottom bar stays where the
          // 844px viewport ends and covers that band of the page.
          await expect(page).toHaveScreenshot(`${capture.name}-${device}-${colorScheme}.png`, {
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
            mask: capture.mask?.(page),
            maxDiffPixelRatio: 0.002,
          });
        });
      }
    });
  }
}
