import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

// Fails the run once, before any scenario, when Chromium cannot start. Without this every test
// reports its own launch error. It never downloads a browser; installing one is an explicit step.
// Global setup for `npm run screenshots` (scripts/screenshots.config.ts), and the first step of
// e2e/global-setup.ts.
export default async function checkChromium(): Promise<void> {
  const override = process.env.CHROMIUM_PATH;
  if (override && !existsSync(override)) {
    throw new Error(`CHROMIUM_PATH is set to ${override}, which does not exist. Point it at a Chromium or chrome-headless-shell binary, or unset it and run \`npm run test:e2e:install\`.`);
  }
  try {
    const browser = await chromium.launch(override ? { executablePath: override } : {});
    await browser.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Executable doesn't exist")) throw error;
    const missing = /Executable doesn't exist at (\S+)/.exec(message)?.[1] ?? 'the Playwright browser cache';
    throw new Error([
      `The Chromium build this Playwright version needs is not installed (looked for ${missing}).`,
      'Either install it once with `npm run test:e2e:install`,',
      'or set CHROMIUM_PATH to an existing Chromium or chrome-headless-shell binary.',
    ].join('\n'));
  }
}
