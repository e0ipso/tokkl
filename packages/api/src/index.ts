import { createApp } from './app.ts';
import { ConfigurationError, loadConfig } from './config.ts';
import { initializeDatabase } from './storage/migrations.ts';
import { createStorage } from './storage/index.ts';
import { startTimerBus } from './storage/timerBus.ts';
import type { TimerBus } from './domain/timerBus.ts';
import { safeDestination } from './storage/config.ts';
import { initializeSetupCode } from './domain/accounts.ts';
import type { Storage } from './storage/contracts.ts';
const creatorLine = (code: string) => `No admin account yet. Open the web UI and use this setup code to create it: ${code}`;
const PENDING_LINE = 'No admin account yet. The setup code was printed in the log of the instance that created it. Run npm run setup:code to print a replacement.';
/**
 * The setup line to print once listening, or undefined when an admin exists. Without a configured
 * code this stores a shared code when none is pending. Its plaintext comes back only from the
 * transaction that committed it, so a retried attempt never prints a discarded code.
 */
async function setupNotice(storage: Storage, explicitCode: string | null): Promise<string | undefined> {
  if (explicitCode !== null) return await storage.users.count() === 0 ? creatorLine(explicitCode) : undefined;
  const state = await initializeSetupCode(storage);
  if (state.kind === 'generated') return creatorLine(state.code);
  if (state.kind === 'pending') return PENDING_LINE;
}
async function main(): Promise<void> {
  const { config, notices } = loadConfig();
  for (const notice of notices)
    console.warn(notice);
  const storage = createStorage(await initializeDatabase(config.storage));
  let bus: TimerBus | undefined;
  try {
    const setup = { explicitCode: config.setupCode ?? null };
    const notice = await setupNotice(storage, setup.explicitCode);
    // A process must hear other instances' timer signals before it reports that it is listening.
    const timerBus = bus = await startTimerBus(config.storage);
    const app = createApp({ storage, config, setup, timerBus });
    const server = app.listen(config.port, config.host);
    let stopping: Promise<void> | undefined;
    const shutdown = () => stopping ??= (async () => {
      const drained = new Promise<void>(resolve => server.close(() => resolve()));
      const deadline = setTimeout(() => server.closeAllConnections(), 10000);
      deadline.unref();
      try {
        const results = await Promise.allSettled([app.locals.close(), drained]);
        if (results.some(result => result.status === 'rejected'))
          throw new Error('HTTP shutdown failed');
      }
      finally {
        clearTimeout(deadline);
        // Streams are closed by now. Storage still closes if the bus cannot.
        await timerBus.close().catch(() => { console.error('Timer bus close failed'); });
        await storage.close();
      }
    })();
    server.on('error', () => { console.error('HTTP server failed'); process.exitCode = 1; void shutdown().catch(() => { console.error('Shutdown failed'); process.exitCode = 1; }); });
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, () => {
        console.log(`${signal} received, shutting down`);
        void shutdown().catch(() => { console.error('Shutdown failed'); process.exitCode = 1; });
      });
    server.once('listening', () => {
      console.log(`tokkl listening on http://${config.host}:${config.port} (${safeDestination(config.storage)})`);
      if (notice)
        console.log(notice);
    });
  }
  catch (error) {
    await bus?.close().catch(() => {});
    await storage.close();
    throw error;
  }
}
// Other errors can carry connection details, so only configuration errors print their message.
await main().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? `Startup failed. ${error.message}` : 'Startup failed. Check database configuration, supported schema and connectivity.');
  process.exitCode = 1;
});
