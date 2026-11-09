import type { Request, Response, RequestHandler } from 'express';
import type { ReadQueries } from '../domain/queries.ts';
import type { AuthMiddleware } from '../auth/middleware.ts';
import type { SessionHandlers } from '../auth/sessions.ts';
import type { ApplicationServices } from '../services/application.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';

/**
 * What `createHttpApp` in `app.ts` builds once for the routers. Each router names the part it uses
 * with `Pick`, so none of them sees storage, configuration or how an operation publishes.
 */
export interface Deps extends ApplicationServices {
  /**
   * Failed password attempts, shared by the login form, Basic auth and password change. Each check
   * is charged to the account from its address, the account and the address (`passwordCounters`).
   * Unknown invite tokens count against the same address counter (`addressCounter`).
   */
  loginLimiter: FailureLimiter;
  /** Request authentication: Basic auth, API tokens and session cookies. */
  auth: AuthMiddleware;
  /** Setup, sign-in, sign-out, invite and password reset handlers. */
  sessions: SessionHandlers;
}

declare module 'express-serve-static-core' {
  interface Locals {
    /** Aborted when the client goes away or the server shuts down; set in `createHttpApp`. */
    workSignal: AbortSignal;
  }
}

/** Authenticate and collect a JSON response in one snapshot; send only after releasing it. */
export function jsonRead(
  deps: Pick<Deps, 'readFor'>,
  work: (req: Request, res: Response, queries: ReadQueries) => unknown,
  administrative = false,
): RequestHandler {
  return async (req, res) => {
    const body = await deps.readFor(res.locals.auth, async queries => work(req, res, queries), administrative);
    res.json(body);
  };
}
