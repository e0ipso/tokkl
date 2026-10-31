import type { Request, Response, RequestHandler } from 'express';
import type { Repositories, Storage } from '../storage/contracts.ts';
import type { StorageAuthentication } from '../auth/storageMiddleware.ts';
import type { ApplicationServices } from '../services/application.ts';
import type { Config } from '../config.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import type { TimerStreams } from '../services/timerStreams.ts';
import { badRequest } from '../lib/errors.ts';

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
  /**
   * Open timer event streams. Anything that may end a credential (logout, token rotation, a
   * password change or reset, suspension, deletion) calls `recheck` for the account after it commits.
   */
  timerStreams: TimerStreams;
}

declare module 'express-serve-static-core' {
  interface Locals {
    auth: StorageAuthentication;
    workSignal: AbortSignal;
  }
}

/** Authenticate and collect a JSON response in one snapshot; send only after releasing it. */
export function jsonRead(deps: Deps, work: (req: Request, res: Response, repositories: Repositories) => unknown | Promise<unknown>, administrative = false): RequestHandler {
  return async (req, res) => {
    const body = await deps.readFor(res.locals.auth, repositories => Promise.resolve(work(req, res, repositories)), administrative);
    res.json(body);
  };
}

/** Bodies arrive as raw text (see createApp), so a missing or wrong Content-Type is not an error. */
function parseBody(req: Request): unknown {
  const text = typeof req.body === 'string' ? req.body : '';
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Invalid JSON input');
  }
}

export function readJson(req: Request): Record<string, unknown> {
  const body = parseBody(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid JSON input');
  return body as Record<string, unknown>;
}

export function readJsonArray(req: Request): unknown[] {
  const body = parseBody(req);
  if (!Array.isArray(body)) throw badRequest('Invalid JSON input: expected an array');
  return body;
}

export function readText(req: Request): string {
  return typeof req.body === 'string' ? req.body : '';
}

/** First value of a query parameter, or undefined. */
export function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function queryFlag(req: Request, name: string): boolean {
  const value = query(req, name);
  return value === 'true' || value === '1';
}

/**
 * The client address used for rate limiting. With TOKKL_TRUST_PROXY, Express takes it from the
 * last X-Forwarded-For hop, which the reverse proxy appends and the client cannot forge.
 */
export function clientAddress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
