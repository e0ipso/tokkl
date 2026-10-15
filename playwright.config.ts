import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.E2E_PORT ?? 8095);

// Every Playwright process loads this file, and workers inherit the runner's environment. The
// first load picks a fresh path for the run; the server creates the directory when it starts, so
// `--list` creates nothing. The process that picked the path deletes it when it exits, whether
// the run passed or failed.
let dataDir = process.env.TIMETRACK_E2E_DATA_DIR;
if (!dataDir) {
  const runDir = join(tmpdir(), `timetrack-e2e-${randomUUID()}`);
  dataDir = process.env.TIMETRACK_E2E_DATA_DIR = runDir;
  process.on('exit', () => rmSync(runDir, { recursive: true, force: true }));
}

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
    command: 'node packages/api/src/index.ts',
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
