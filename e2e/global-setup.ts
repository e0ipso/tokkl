import type { FullConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import checkChromium from './chromium-check.ts';
import { RUN_ID_VARIABLE, TestData } from './fixtures.ts';

// Global setup for `npm run test:e2e`. The screenshot config has its own server and setup code and
// creates its demo admin itself, so it runs only the Chromium check.
export default async function globalSetup(config: FullConfig) {
  await checkChromium();

  // Workers inherit the runner's environment, so they all see this run's id.
  process.env[RUN_ID_VARIABLE] = randomUUID().slice(0, 8);

  // The web servers are already up. Create each one's setup admin once here, so parallel workers
  // do not race to set up the server they share. A server on a reused TOKKL_E2E_DATA_DIR can still
  // hold worker accounts from a run that was killed before its workers stopped; delete them.
  for (const baseURL of new Set(config.projects.map((project) => project.use.baseURL))) {
    if (!baseURL) continue;
    const admin = await TestData.open(baseURL);
    try {
      await admin.deleteWorkerAccounts();
    } finally {
      await admin.close();
    }
  }
}
