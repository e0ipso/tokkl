import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import type { Deps } from './http/context.ts';
import { ADDRESS_LIMIT, FailureLimiter, PASSWORD_WINDOW_MS, SETUP_CODE_LIMIT } from './auth/rateLimit.ts';
import { HttpError } from './lib/errors.ts';
import { appRoutes, type SetupState } from './routes/app.ts';
import { appReportRoutes, reportsV3Routes } from './routes/reports.ts';
import { togglV9Routes } from './routes/togglV9.ts';

export interface AppOptions {
  db: Db;
  config: Config;
  setup: SetupState;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  // Only meaningful over HTTPS, which here means "the reverse proxy said so".
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
};

/**
 * Bodies are read as text whatever the Content-Type, then parsed by the route. Toggl clients do
 * not always send `Content-Type: application/json`, and the import routes take raw CSV or JSON.
 */
const textBody = (limit: string) => express.text({ type: () => true, limit });

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json(error.message);
  // Date helpers throw RangeError on impossible input; that is the caller's mistake, not ours.
  if (error instanceof RangeError) return res.status(400).json(error.message);
  const type = (error as { type?: string }).type;
  if (type === 'entity.too.large') return res.status(413).json('Request body too large');
  if (type?.startsWith('entity.') || type?.startsWith('request.')) return res.status(400).json('Invalid request body');
  // http-errors from Express itself, e.g. a missing file under /assets.
  const status = (error as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) return res.status(status).json(error.message);
  console.error(error);
  return res.status(500).json('Internal Server Error');
};

export function createApp({ db, config, setup }: AppOptions): Express {
  const app = express();
  const deps: Deps = {
    db,
    config,
    loginLimiter: new FailureLimiter(ADDRESS_LIMIT, PASSWORD_WINDOW_MS),
    setupLimiter: new FailureLimiter(SETUP_CODE_LIMIT, PASSWORD_WINDOW_MS),
  };

  app.disable('x-powered-by');
  app.set('etag', false);
  // One hop: the reverse proxy. req.ip becomes the address it appended to X-Forwarded-For, and
  // req.secure follows its X-Forwarded-Proto.
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(securityHeaders);

  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  app.use('/api/app/import', textBody('50mb'));
  app.use(['/api', '/reports/api'], textBody('1mb'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/v9', togglV9Routes(deps));
  app.use('/reports/api/v3', reportsV3Routes(deps));
  app.use('/api/app', appRoutes(deps, setup), appReportRoutes(deps));
  app.use(['/api', '/reports/api'], (req, res) => {
    res.status(404).json('Not found');
  });

  const indexPath = join(config.webRoot, 'index.html');
  if (existsSync(indexPath)) {
    // Hashed assets never change, so they can be cached for good. A miss must not fall through to
    // index.html, or a browser would cache HTML under a script URL for a year.
    app.use('/assets', express.static(join(config.webRoot, 'assets'), {
      immutable: true,
      maxAge: '365d',
      fallthrough: false,
    }));
    app.use(express.static(config.webRoot, { index: false }));
    // Read on every request (it is under 1 KB) so a rebuild never leaves the server pointing at
    // asset files that no longer exist.
    app.get('/{*path}', (req, res) => {
      res.set('Cache-Control', 'no-cache').type('html').send(readFileSync(indexPath, 'utf8'));
    });
  } else {
    app.get('/', (req, res) => {
      res.type('text').send('Web UI not built. Run "npm run build" or use the dev server on port 5173.');
    });
  }

  app.use(errorHandler);
  return app;
}
