import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.E2E_PORT ?? 8095);
const dataDir = mkdtempSync(join(tmpdir(), 'timetrack-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server/src/index.ts',
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      TIMETRACK_DATA_DIR: dataDir,
      TIMETRACK_SETUP_CODE: 'E2E-SETUP-CODE',
    },
  },
});
