import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { claimDataDir } from './e2e/data-dir-lock.ts';

const port = Number(process.env.E2E_PORT ?? 8095);
// The instance project's own server. Its specs need the whole server to themselves.
const instancePort = Number(process.env.E2E_INSTANCE_PORT ?? port + 1);

// Every Playwright process loads this file, and workers inherit the runner's environment. The
// first load picks a fresh path for the run; the servers create their directories when they
// start, so `--list` creates nothing. The process that picked the path deletes it when it exits,
// whether the run passed or failed.
//
// A preset TOKKL_E2E_DATA_DIR is used as is, and the first load claims it for this run (see
// e2e/data-dir-lock.ts): a second run on the same directory fails here, before any server starts.
// TOKKL_E2E_DATA_DIR_CLAIMED tells later loads, in the workers, that the runner has done this.
let dataDir = process.env.TOKKL_E2E_DATA_DIR;
if (!dataDir) {
  const runDir = join(tmpdir(), `tokkl-e2e-${randomUUID()}`);
  dataDir = process.env.TOKKL_E2E_DATA_DIR = runDir;
  process.env.TOKKL_E2E_DATA_DIR_CLAIMED = '1';
  process.on('exit', () => {
    for (const dir of [runDir, `${runDir}-instance`]) rmSync(dir, { recursive: true, force: true });
  });
} else if (!process.env.TOKKL_E2E_DATA_DIR_CLAIMED) {
  // The servers run in this file's directory, so a relative path is resolved from here too.
  const release = claimDataDir(resolve(import.meta.dirname, dataDir));
  process.env.TOKKL_E2E_DATA_DIR_CLAIMED = '1';
  process.on('exit', release);
}

// Specs that need the whole server: they sign in as the setup admin, list every account or invite,
// change instance settings, compare screenshots of the admin page, or start disposable servers on
// the fixed ports E2E_PORT + 50 to + 59. They run one at a time on their own server, alongside the
// parallel project.
const INSTANCE_SPECS = /\/(admin-page|visual|worker-accounts|auth-(access|browser|invite|reset|sessions|token))\.spec\.ts$/;

function server(serverPort: number, serverDataDir: string) {
  return {
    command: 'node packages/api/src/index.ts',
    url: `http://127.0.0.1:${serverPort}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(serverPort),
      HOST: '127.0.0.1',
      TOKKL_DATA_DIR: serverDataDir,
      TOKKL_SETUP_CODE: 'E2E-SETUP-CODE',
    },
  };
}

export default defineConfig<object, { instanceWide: boolean }>({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Half the CPU cores; pass --workers to change it. The instance project never uses more than one.
  workers: '50%',
  reporter: 'list',
  use: {
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      // Each worker signs in as its own user (the `account` fixture in e2e/fixtures.ts).
      name: 'desktop',
      testIgnore: INSTANCE_SPECS,
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}` },
    },
    {
      name: 'instance',
      testMatch: INSTANCE_SPECS,
      fullyParallel: false,
      workers: 1,
      // Keep the visual baselines' names from when every spec ran in the desktop project.
      snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-desktop{-snapshotSuffix}{ext}',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${instancePort}`, instanceWide: true },
    },
  ],
  webServer: [server(port, dataDir), server(instancePort, `${dataDir}-instance`)],
});
