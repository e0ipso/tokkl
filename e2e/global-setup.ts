import type { FullConfig } from '@playwright/test';
import checkChromium from './chromium-check.ts';
import { TestData } from './fixtures.ts';

// Global setup for `npm run test:e2e`. The screenshot config has its own server and setup code and
// creates its demo admin itself, so it runs only the Chromium check.
export default async function globalSetup(config: FullConfig) {
  await checkChromium();

  // The web servers are already up. Create each one's setup admin once here, so parallel workers
  // do not race to set up the server they share.
  for (const baseURL of new Set(config.projects.map((project) => project.use.baseURL))) {
    if (baseURL) await (await TestData.open(baseURL)).close();
  }
}
