import type { FullConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import checkChromium from './chromium-check.ts';
import { RUN_ID_VARIABLE, TestData } from './fixtures.ts';

// The screenshot config has its own server and setup, so it runs only the Chromium check.
export default async function globalSetup(config: FullConfig) {
  await checkChromium();

  process.env[RUN_ID_VARIABLE] = randomUUID().slice(0, 8);

  // Create each server's setup admin once here, so workers do not race, and delete worker accounts a killed run left.
  for (const baseURL of new Set(config.projects.map(project => project.use.baseURL))) {
    if (!baseURL) continue;
    const admin = await TestData.open(baseURL);
    try {
      await admin.deleteWorkerAccounts();
    } finally {
      await admin.close();
    }
  }
}
