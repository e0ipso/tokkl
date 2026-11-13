import type { Locator, Page } from '@playwright/test';
import { expect, test, type Account, type ExtraUsers, type TestData } from './fixtures.ts';
import { login, loginAs } from './helpers.ts';
import { PHONE } from './mobile-tests-helpers.ts';
import { transferFixture } from './transfer-tests-helpers.ts';

// Baselines in visual.spec.ts-snapshots/; refresh with `npx playwright test visual --update-snapshots=all`.
// The browser clock is fixed at NOW; the server keeps real time, so admin dates are masked.

const CSRF = { 'X-Tokkl-CSRF': '1' };
/** In Europe/Madrid (the config's timezone). */
const NOW = '2026-07-16T13:20:00.000Z';

const DEVICES = { desktop: {}, phone: PHONE } as const;
const SCHEMES = ['light', 'dark'] as const;

interface Capture {
  name: string;
  path: string;
  timerView?: 'list' | 'calendar';
  ready: (page: Page) => Locator;
  regularUser?: { email: string; fullname: string };
  prepare?: (data: TestData, users: ExtraUsers) => Promise<void>;
  /** Parts that follow the server's real clock. */
  mask?: (page: Page) => Locator[];
  act?: (page: Page) => Promise<void>;
  settle?: (page: Page) => Promise<void>;
}

const PAGES: readonly Capture[] = [
  {
    name: 'timer-list',
    path: '/',
    timerView: 'list',
    ready: page => page.locator('.entry-list').getByRole('button', { name: 'Roadmap' }),
  },
  {
    name: 'timer-calendar',
    path: '/',
    timerView: 'calendar',
    // A phone shows only today, which has no entry; the strip's total for the "Planning" day shows the week has loaded.
    ready: page =>
      page
        .locator('.calendar-grid')
        .getByText('Planning')
        .first()
        .or(page.getByRole('group', { name: 'Days of the week' }).getByRole('button', { name: 'Wed 15 Jul, 1:00:00' })),
  },
  {
    name: 'reports-summary',
    path: '/reports?from=2026-07-13&to=2026-07-19',
    ready: page => page.getByRole('region', { name: 'Breakdown' }).getByText('Roadmap').first(),
  },
  {
    name: 'pomodoro-idle',
    path: '/pomodoro',
    ready: page =>
      page
        .getByRole('form', { name: 'Start a Pomodoro session' })
        .getByRole('spinbutton', { name: 'Work', exact: true }),
  },
  {
    name: 'pomodoro-running',
    path: '/pomodoro',
    act: page =>
      page.getByRole('form', { name: 'Start a Pomodoro session' }).getByRole('button', { name: 'Start' }).click(),
    ready: page => page.getByRole('timer', { name: 'Time remaining' }).getByText('25:00', { exact: true }),
    // Clicking Start scrolls the taller start form; the phone's fixed bottom bar follows the scroll.
    settle: page => page.evaluate(() => window.scrollTo(0, 0)),
  },
  { name: 'projects', path: '/projects', ready: page => page.getByRole('main').getByText('Website').first() },
  {
    name: 'settings',
    path: '/settings/profile',
    ready: page => page.getByRole('form', { name: 'Profile' }),
    regularUser: { email: 'e2e-user@example.com', fullname: 'E2E User' },
  },
  {
    name: 'admin',
    path: '/admin/users',
    ready: page => page.locator('#users').getByText('Regular Rita'),
    prepare: async (data, users) => {
      await users.create({ email: 'rita@example.com', fullname: 'Regular Rita' });
      await data.createInvite({ role: 'user', note: 'For the design team' });
    },
    mask: page => [page.locator('.admin-date')],
  },
];

async function post(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, { headers: CSRF, data });
  expect(response.ok(), `POST ${path} answered ${response.status()}`).toBe(true);
}

async function seed(page: Page, timerView: Capture['timerView'], account?: Account): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW));
  if (account) await loginAs(page, account);
  else await login(page);
  const backup = transferFixture('restore-full.json');
  await post(page, '/api/app/import/json', JSON.parse(backup.buffer.toString('utf8')));
  // The shared fixture does not reset the theme; "system" lets colorScheme pick light or dark.
  await post(page, '/api/v9/me/preferences', { theme: 'system', timerView: timerView ?? 'list' });
}

/** Writes a fixed origin over the server's, whose port varies, so the baseline does not depend on it. */
async function pinOrigin(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const code of document.querySelectorAll('code')) {
      const text = code.textContent ?? '';
      if (text.includes(window.location.origin))
        code.textContent = text.replaceAll(window.location.origin, 'http://127.0.0.1:8095');
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
          await capture.act?.(page);
          await expect(capture.ready(page)).toBeVisible();
          await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await pinOrigin(page);
          await capture.settle?.(page);
          const heightBeforeCapture = await page.evaluate(() => document.documentElement.scrollHeight);
          // On the phone the fixed bottom bar covers the band where the 844px viewport ends.
          await expect(page).toHaveScreenshot(`${capture.name}-${device}-${colorScheme}.png`, {
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
            mask: capture.mask?.(page),
            maxDiffPixelRatio: 0.002,
          });
          expect(
            await page.evaluate(() => document.documentElement.scrollHeight),
            'The full-page capture must not change the document height',
          ).toBe(heightBeforeCapture);
        });
      }
    });
  }
}
