import { ConfigurationError, loadConfig } from './config.ts';
import { rotateSetupCode } from './domain/accounts.ts';
import { initializeDatabase } from './storage/migrations.ts';
import { createStorage } from './storage/index.ts';

// Replaces a lost first-admin setup code. It opens storage only: no HTTP server, timer bus or workers.
// Running API processes read the stored hash on every attempt, so they accept the new code at once.
async function main(): Promise<void> {
  const { config, notices } = loadConfig();
  for (const notice of notices)
    console.warn(notice);
  if (config.setupCode) {
    console.error('TOKKL_SETUP_CODE is set, so it is the setup code. Change that setting instead.');
    process.exitCode = 1;
    return;
  }
  const storage = createStorage(await initializeDatabase(config.storage));
  try {
    const result = await rotateSetupCode(storage);
    if (result.kind === 'complete') {
      console.error('Setup is already complete. An account exists, so there is no setup code to replace.');
      process.exitCode = 1;
      return;
    }
    // The transaction has committed by now, so the printed code is the one that works.
    console.log(`New setup code: ${result.code}. Earlier setup codes no longer work.`);
  }
  finally {
    await storage.close();
  }
}
// Other errors can carry connection details, so only configuration errors print their message.
await main().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? `Setup code failed. ${error.message}` : 'Setup code failed. Check database configuration, supported schema and connectivity.');
  process.exitCode = 1;
});
