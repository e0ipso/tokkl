import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from '../lib/logger.ts';

declare module 'express-serve-static-core' {
  interface Locals {
    log: Logger;
    /** See createRouter. */
    mountPath?: string;
  }
}

/** A caller-chosen id is kept only when short and plain, so it cannot forge log fields. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function requestId(req: Request): string {
  const offered = req.get('x-request-id');
  return offered !== undefined && REQUEST_ID.test(offered) ? offered : randomUUID();
}

/** Raw paths are never logged: invite and password-reset links carry their secret in the path. */
function routeOf(req: Request, res: Response): string | null {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (typeof route?.path !== 'string') return null;
  return `${res.locals.mountPath ?? req.baseUrl}${route.path}`;
}

/** One access line per request: method, route pattern, status and duration. No query, header or body. */
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    const log = logger.child({ requestId: requestId(req) });
    res.locals.log = log;
    res.once('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - started) / 1000n) / 1000;
      log.info('Request', { method: req.method, route: routeOf(req, res), status: res.statusCode, durationMs });
    });
    res.once('close', () => {
      if (res.writableFinished) return;
      log.info('Request aborted', { method: req.method, route: routeOf(req, res), status: res.statusCode });
    });
    next();
  };
}
