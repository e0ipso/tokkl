import type { Request, Response, RequestHandler } from 'express';
import type { Storage } from '../storage/contracts.ts';
import type { ReadQueries } from '../domain/queries.ts';
import type { StorageAuth } from '../auth/middleware.ts';
import type { ApplicationServices } from '../services/application.ts';
import type { Config } from '../config.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import type { TimerStreams } from '../services/timerStreams.ts';

/** Shared by every router; created once in createApp. */
export interface Deps extends ApplicationServices {
  storage: Storage;
  config: Config;
  /**
   * Failed password attempts, shared by the login form, Basic auth and password change. Each check
   * is charged to the account from its address, the account and the address (`passwordCounters`).
   * Unknown invite tokens count against the same address counter (`addressCounter`).
   */
  loginLimiter: FailureLimiter;
  /** Wrong setup codes per client address, counted apart from passwords. */
  setupLimiter: FailureLimiter;
  /** Request authentication: Basic auth, API tokens and session cookies. */
  auth: StorageAuth;
  /**
   * Open timer event streams. Anything that may end a credential (logout, token rotation, a
   * password change or reset, suspension, deletion) calls `recheck` for the account after it commits.
   */
  timerStreams: TimerStreams;
}

declare module 'express-serve-static-core' {
  interface Locals {
    /** Aborted when the client goes away or the server shuts down; set in createApp. */
    workSignal: AbortSignal;
  }
}

/** Authenticate and collect a JSON response in one snapshot; send only after releasing it. */
export function jsonRead(
  deps: Deps,
  work: (req: Request, res: Response, queries: ReadQueries) => unknown,
  administrative = false,
): RequestHandler {
  return async (req, res) => {
    const body = await deps.readFor(res.locals.auth, async queries => work(req, res, queries), administrative);
    res.json(body);
  };
}
