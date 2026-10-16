import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOW, TIME_ZONE } from './screenshots-data.ts';

// Playwright config for `npm run screenshots`. It lives outside e2e/, so `npm run test:e2e` never
// runs it. The server gets a throwaway data directory and a clock stopped at NOW, so reports and
// running timers come out the same on every run.

const port = Number(process.env.SCREENSHOTS_PORT ?? 8096);

let dataDir = process.env.TOKKL_SCREENSHOTS_DATA_DIR;
if (!dataDir) {
  const runDir = join(tmpdir(), `tokkl-screenshots-${randomUUID()}`);
  dataDir = process.env.TOKKL_SCREENSHOTS_DATA_DIR = runDir;
  process.on('exit', () => rmSync(runDir, { recursive: true, force: true }));
}

/** Replaces Date in the server process with one that always reads NOW. */
function frozenClockImport(now: string): string {
  const source = `
    const frozen = ${JSON.stringify(Date.parse(now))};
    const RealDate = Date;
    globalThis.Date = class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(frozen); else super(...args); }
      static now() { return frozen; }
    };
  `;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.ts',
  // Only the Chromium check: scripts/screenshots.ts creates its own admin through setup.
  globalSetup: '../e2e/chromium-check.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: TIME_ZONE,
    locale: 'en-US',
    colorScheme: 'light',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `node --import "${frozenClockImport(NOW)}" packages/api/src/index.ts`,
    cwd: '..',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      TOKKL_DATA_DIR: dataDir,
      TOKKL_SETUP_CODE: 'SCREENSHOTS-SETUP-CODE',
      // The session cookie expires sessionDays after NOW. With the default 30 days the browser
      // would drop it as already expired once the real date is past NOW + 30 days.
      TOKKL_SESSION_DAYS: '36500',
    },
  },
});
