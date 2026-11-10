import { randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import { createHttpApp, type HttpApp } from './app.ts';
import { ConfigurationError, loadConfig, type Config } from './config.ts';
import { systemClock } from './lib/clock.ts';
import { createReportRunner } from './reportRunners.ts';
import { createApplicationServices, DEFAULT_SERVICE_SETTINGS } from './services/application.ts';
import { initializeDatabase } from './storage/migrations.ts';
import { createStorage } from './storage/index.ts';
import { startTimerBus } from './storage/timerBus.ts';
import type { TimerBus } from './storage/timerBus.ts';
import type { Storage } from './domain/ports.ts';
import { safeDestination } from './storage/config.ts';
import { createLogger, redactedDiagnostic, type Logger } from './lib/logger.ts';

/** How long a graceful shutdown waits for open connections. */
const SHUTDOWN_GRACE_MS = 10_000;

function setupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += alphabet[randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

interface Running {
  server: Server;
  http: HttpApp;
  timerBus: TimerBus;
  storage: Storage;
}

/** Once. */
function shutdownOnce({ server, http, timerBus, storage }: Running, logger: Logger): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () =>
    (stopping ??= (async () => {
      const drained = new Promise<void>(resolve => server.close(() => resolve()));
      const deadline = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
      deadline.unref();
      try {
        const results = await Promise.allSettled([http.close(), drained]);
        if (results.some(result => result.status === 'rejected')) throw new Error('HTTP shutdown failed');
      } finally {
        clearTimeout(deadline);
        // Streams are closed by now. Storage still closes if the bus cannot.
        await timerBus.close().catch((error: unknown) => logger.error('Timer bus close failed', { error }));
        await storage.close();
      }
    })());
}

function superviseServer(running: Running, config: Config, setup: { code: string | null }, logger: Logger): void {
  const shutdown = shutdownOnce(running, logger);
  const stop = () =>
    void shutdown().catch((error: unknown) => {
      logger.error('Shutdown failed', { error });
      process.exitCode = 1;
    });
  running.server.on('error', error => {
    logger.error('HTTP server failed', { error });
    process.exitCode = 1;
    stop();
  });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      logger.info(`${signal} received, shutting down`);
      stop();
    });
  running.server.once('listening', () => {
    logger.info(`tokkl listening on http://${config.host}:${config.port} (${safeDestination(config.storage)})`);
    if (setup.code)
      logger.info(`No admin account yet. Open the web UI and use this setup code to create it: ${setup.code}`);
  });
}

async function main(): Promise<void> {
  const { config, notices } = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  for (const notice of notices) logger.warn(notice);
  const storage = createStorage(await initializeDatabase(config.storage), {
    // The runner holds no request, so the line has no request id. The diagnostic leaves out the
    // error's message, which may carry SQL or row values.
    afterCommitFailed: error => logger.error('After-commit work failed', { diagnostic: redactedDiagnostic(error) }),
  });
  let timerBus: TimerBus | undefined;
  try {
    const setup = {
      code:
        (await storage.readSnapshot(repositories => repositories.users.count())) === 0
          ? (config.setupCode ?? setupCode())
          : null,
    };
    // A process must hear other instances' timer signals before it reports that it is listening.
    timerBus = await startTimerBus(config.storage, logger);
    const services = createApplicationServices({
      storage,
      reports: createReportRunner(config.storage, storage, { logger }),
      settings: DEFAULT_SERVICE_SETTINGS,
      bus: timerBus,
      clock: systemClock,
      logger,
      sessionDays: config.sessionDays,
    });
    const http = createHttpApp(services, { storage, config, setup, logger });
    const server = http.app.listen(config.port, config.host);
    superviseServer({ server, http, timerBus, storage }, config, setup, logger);
  } catch (error) {
    await timerBus?.close().catch(() => {});
    await storage.close();
    throw error;
  }
}

// Other errors can carry connection details, so only configuration errors print their message.
await main().catch((error: unknown) => {
  createLogger().error(
    error instanceof ConfigurationError
      ? `Startup failed. ${error.message}`
      : 'Startup failed. Check database configuration, supported schema and connectivity.',
  );
  process.exitCode = 1;
});
