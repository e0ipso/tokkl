import type { Request, RequestHandler } from 'express';
import type { Deps } from '../http/context.ts';
import { clientAddress, getCookie } from '../http/context.ts';
import { forbidden, tooManyRequests } from '../lib/errors.ts';
import { findUserByApiToken, findUserByEmail, getUser, isActiveAdmin, isActiveUser, type UserRow } from '../models/users.ts';
import { safeEqual, verifyAgainstDummy, verifyPassword } from './crypto.ts';
import { passwordCounters } from './rateLimit.ts';
import { findSessionUser, LEGACY_SESSION_COOKIE, SESSION_COOKIE } from './sessions.ts';

export const CSRF_HEADER = 'x-tokkl-csrf';
/** CSRF header name from before the rename to Tokkl. Still accepted, so an open tab keeps saving after an upgrade. */
export const LEGACY_CSRF_HEADER = 'x-timetrack-csrf';

/** A cross-site form cannot set this header, and the server never grants the CORS preflight it needs. */
export function hasCsrfHeader(req: Request): boolean {
  return req.headers[CSRF_HEADER] === '1' || req.headers[LEGACY_CSRF_HEADER] === '1';
}

/** Session tokens sent in the current cookie and in the cookie from before the rename, current first. */
export function sessionTokens(req: Request): string[] {
  return [getCookie(req, SESSION_COOKIE), getCookie(req, LEGACY_SESSION_COOKIE)].filter((token) => token !== undefined);
}

/** The first session token that belongs to a live session, with its user. */
export function findSession(db: Deps['db'], req: Request): { token: string; user: UserRow } | undefined {
  for (const token of sessionTokens(req)) {
    const user = findSessionUser(db, token);
    if (user) return { token, user };
  }
  return undefined;
}

function decodeBasic(header: string): { username: string; password: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Checks a password for an account looked up by email. A suspended account fails like a wrong password,
 * after the same scrypt run, so the limiter charges it and the response does not reveal the account.
 */
export async function verifyAccountPassword(user: UserRow | undefined, password: string): Promise<boolean> {
  if (!user) return verifyAgainstDummy(password);
  return (await verifyPassword(password, user.password_hash)) && isActiveUser(user);
}

/**
 * The account as stored now, once its password check has passed, or undefined when it was deleted or
 * suspended while scrypt ran. Authorize with this row, not the one read before the check, so a
 * demotion or suspension made during the check applies to the request.
 */
export function currentActiveUser(db: Deps['db'], user: UserRow): UserRow | undefined {
  const current = getUser(db, user.id);
  return current && isActiveUser(current) ? current : undefined;
}

async function userFromBasic(deps: Deps, req: Request, header: string): Promise<UserRow> {
  const credentials = decodeBasic(header);
  if (!credentials) throw forbidden('Incorrect username and/or password');

  // API tokens are 128-bit random values, so only password attempts are rate limited.
  if (credentials.password === 'api_token') {
    const candidate = findUserByApiToken(deps.db, credentials.username);
    if (candidate && isActiveUser(candidate) && safeEqual(candidate.api_token, credentials.username)) return candidate;
    throw forbidden('Incorrect username and/or password');
  }

  const candidate = findUserByEmail(deps.db, credentials.username);
  const counters = passwordCounters(credentials.username, clientAddress(req));
  const valid = await deps.loginLimiter.attempt(counters, () => verifyAccountPassword(candidate, credentials.password));
  if (valid === null) throw tooManyRequests('Too many failed login attempts, try again later', deps.loginLimiter.retryAfterSeconds(counters));
  const account = candidate && valid ? currentActiveUser(deps.db, candidate) : undefined;
  if (account) return account;
  throw forbidden('Incorrect username and/or password');
}

/**
 * Accepts Toggl-style HTTP Basic auth ("<api_token>:api_token" or "<email>:<password>") or the web
 * app's session cookie. Cookie-authenticated writes must carry the CSRF header, which a cross-site
 * form cannot set.
 */
export function requireAuth(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (header) {
      res.locals.user = await userFromBasic(deps, req, header);
      res.locals.authMethod = 'basic';
      return next();
    }
    const session = findSession(deps.db, req);
    if (!session) throw forbidden('Incorrect username and/or password');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !hasCsrfHeader(req)) {
      throw forbidden('Missing CSRF header');
    }
    res.locals.user = session.user;
    res.locals.authMethod = 'session';
    res.locals.sessionToken = session.token;
    return next();
  };
}

/** Runs after requireAuth. Only an active instance admin gets through. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  const user = res.locals.user as UserRow | undefined;
  if (!user || !isActiveAdmin(user)) throw forbidden('Admin access required');
  next();
};
