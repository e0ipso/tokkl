import express, { type Express } from 'express';
import type { Config } from './config.ts';
import type { Storage } from './storage/contracts.ts';
import { standaloneRateLimits } from './storage/index.ts';
import { createApplicationServices } from './services/application.ts';
import { createLocalTimerBus, type TimerBus } from './storage/timerBus.ts';
import type { Deps } from './http/context.ts';
import { ADDRESS_LIMIT, FailureLimiter, PASSWORD_WINDOW_MS, SETUP_CODE_LIMIT } from './auth/rateLimit.ts';
import { createStorageAuth } from './auth/middleware.ts';
import { errorHandler } from './http/errors.ts';
import { requestLog } from './http/requestLog.ts';
import { noStore, securityHeaders } from './http/security.ts';
import { webRootRoutes } from './http/webRoot.ts';
import { createLogger, type Logger } from './lib/logger.ts';
import { adminRoutes } from './routes/admin.ts';
import { appRoutes, type SetupState } from './routes/app.ts';
import { appReportRoutes, reportsV3Routes } from './routes/reports.ts';
import { timerRoutes } from './routes/timer.ts';
import { togglV9Routes } from './routes/toggl/index.ts';

export interface AppOptions {
  storage: Storage;
  config: Config;
  setup: SetupState;
  timerStreamOptions?: import('./services/timerStreams.ts').TimerStreamOptions;
  /** Signals timer revisions to other API processes. Defaults to the single-process bus. The
   * caller owns its lifetime; the app never closes it. */
  timerBus?: TimerBus;
  /** Where request failures and background errors are logged. Defaults to JSON lines on stdout/stderr. */
  logger?: Logger;
}

/**
 * Bodies are read as text whatever the Content-Type, then parsed by the route. Toggl clients do
 * not always send `Content-Type: application/json`, and the import routes take raw CSV or JSON.
 */
const textBody = (limit: string) => express.text({ type: () => true, limit });

export function createApp({
  storage,
  config,
  setup,
  timerStreamOptions,
  timerBus = createLocalTimerBus(),
  logger = createLogger({ level: config.logLevel }),
}: AppOptions): Express {
  const app = express();
  const rateLimits = standaloneRateLimits(storage);
  const loginLimiter = new FailureLimiter(rateLimits, 'password', ADDRESS_LIMIT, PASSWORD_WINDOW_MS);
  // The composition root: framework-free services plus the HTTP adapters the routers share.
  const deps: Deps = {
    storage,
    config,
    loginLimiter,
    setupLimiter: new FailureLimiter(rateLimits, 'setup-code', SETUP_CODE_LIMIT, PASSWORD_WINDOW_MS),
    auth: createStorageAuth(storage, loginLimiter),
    ...createApplicationServices({
      storage,
      storageConfig: config.storage,
      streamOptions: timerStreamOptions,
      bus: timerBus,
      logger,
      sessionDays: config.sessionDays,
    }),
  };
  timerBus.receive(signal => {
    deps.publish
      .refresh(signal.userId, signal.revision)
      .catch(error => logger.error('Timer refresh failed', { error }));
  });

  app.disable('x-powered-by');
  app.set('etag', false);
  // A hop count or the proxies' addresses. req.ip becomes the address the outermost trusted proxy
  // appended to X-Forwarded-For, and req.secure follows X-Forwarded-Proto.
  app.set('trust proxy', config.trustProxy);
  app.use(requestLog(logger));
  app.use(securityHeaders);
  const active = new Set<AbortController>();
  let closing = false;
  app.use((req, res, next) => {
    if (closing) {
      res.status(503).json('Server shutting down');
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    res.locals.workSignal = controller.signal;
    res.once('close', () => {
      controller.abort();
      active.delete(controller);
    });
    next();
  });
  app.locals.services = deps;
  app.locals.close = async () => {
    closing = true;
    for (const controller of active) controller.abort();
    await deps.close();
  };

  app.get('/healthz', async (req, res) => {
    await storage.health();
    res.json({ ok: true });
  });

  app.use('/api/app/import', textBody('50mb'));
  app.use(['/api', '/reports/api'], textBody('1mb'), noStore);

  app.use('/api/v9', togglV9Routes(deps));
  app.use('/reports/api/v3', reportsV3Routes(deps));
  app.use('/api/app/admin', adminRoutes(deps));
  app.use('/api/app', appRoutes(deps, setup), appReportRoutes(deps), timerRoutes(deps));
  app.use(['/api', '/reports/api'], (_req, res) => {
    res.status(404).json('Not found');
  });

  app.use(webRootRoutes(config.webRoot));

  app.use(errorHandler(logger));
  return app;
}
