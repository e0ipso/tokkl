import type { Request, Response, RequestHandler } from 'express';
import type { ReadQueries } from '../domain/queries.ts';
import type { AuthMiddleware } from '../auth/middleware.ts';
import type { SessionHandlers } from '../auth/sessions.ts';
import type { ApplicationServices } from '../services/application.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import type { MailConfiguration } from '../config.ts';
import type { Mailer } from '../mail.ts';

/** Each router `Pick`s what it uses, so none sees storage, configuration or how operations publish. */
export interface Deps extends ApplicationServices {
  mailer: Mailer | undefined;
  mail: MailConfiguration;
  publicUrl: string | undefined;
  /** Charged per account+address, account and address; unknown invite tokens hit the address counter. */
  loginLimiter: FailureLimiter;
  auth: AuthMiddleware;
  sessions: SessionHandlers;
}

declare module 'express-serve-static-core' {
  interface Locals {
    /** Aborted when the client goes away or the server shuts down. */
    workSignal: AbortSignal;
  }
}

/** One snapshot; sends only after releasing it. */
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
