import express, { type Express } from 'express';
import type { Config } from './config.ts';
import type { Mailer } from './mail.ts';
import type { Storage } from './domain/ports.ts';
import { standaloneRateLimits } from './storage/index.ts';
import { createSessionAccountOperations, type ApplicationServices } from './services/application.ts';
import type { Deps } from './routes/context.ts';
import { ADDRESS_LIMIT, FailureLimiter, PASSWORD_WINDOW_MS, SETUP_CODE_LIMIT } from './auth/rateLimit.ts';
import { createAuthMiddleware } from './auth/middleware.ts';
import { createSessionHandlers, type SetupState } from './auth/sessions.ts';
import { errorHandler, validationHeaders } from './http/errors.ts';
import { requestLog } from './http/requestLog.ts';
import { noStore, securityHeaders } from './http/security.ts';
import { textBody } from './http/request.ts';
import { webRootRoutes } from './http/webRoot.ts';
import type { Logger } from './lib/logger.ts';
import { adminRoutes } from './routes/admin.ts';
import { appRoutes } from './routes/app.ts';
import { importRoutes } from './routes/imports.ts';
import { appReportRoutes, reportsV3Routes } from './routes/reports.ts';
import { timerRoutes } from './routes/timer.ts';
import { togglV9Routes } from './routes/toggl/index.ts';

export interface HttpAppOptions {
  storage: Storage;
  config: Config;
  setup: SetupState;
  logger: Logger;
  mailer?: Mailer;
}

export interface HttpApp {
  app: Express;
  /** New requests get a 503 and running ones abort; the caller still closes server, bus and storage. */
  close(): Promise<void>;
}

export function createHttpApp(
  services: ApplicationServices,
  { storage, config, setup, logger, mailer }: HttpAppOptions,
): HttpApp {
  const app = express();
  const rateLimits = standaloneRateLimits(storage);
  const loginLimiter = new FailureLimiter(rateLimits, 'password', ADDRESS_LIMIT, PASSWORD_WINDOW_MS);
  const deps: Deps = {
    ...services,
    mailer,
    mail: config.mail,
    publicUrl: config.publicUrl,
    loginLimiter,
    auth: createAuthMiddleware(storage, loginLimiter),
    sessions: createSessionHandlers(storage, createSessionAccountOperations(storage, services), {
      loginLimiter,
      setupLimiter: new FailureLimiter(rateLimits, 'setup-code', SETUP_CODE_LIMIT, PASSWORD_WINDOW_MS),
      sessionDays: config.sessionDays,
      setup,
    }),
  };

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

  app.get('/healthz', async (req, res) => {
    await storage.health();
    res.json({ ok: true });
  });

  app.use('/api/app', validationHeaders);
  // Imports authenticate before they read their larger bodies, so they come before the 1 MB parser.
  app.use('/api/app', importRoutes(deps));
  app.use(['/api', '/reports/api'], textBody('1mb'), noStore);

  app.use('/api/v9', togglV9Routes(deps));
  app.use('/reports/api/v3', reportsV3Routes(deps));
  app.use('/api/app/admin', adminRoutes(deps));
  app.use('/api/app', appRoutes(deps), appReportRoutes(deps), timerRoutes(deps));
  app.use(['/api', '/reports/api'], (_req, res) => {
    res.status(404).json('Not found');
  });

  app.use(webRootRoutes(config.webRoot));

  app.use(errorHandler(logger));
  return {
    app,
    async close() {
      closing = true;
      for (const controller of active) controller.abort();
      await services.close();
    },
  };
}
