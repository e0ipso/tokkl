import type { Request, RequestHandler } from 'express';
import type { Deps } from '../http/context.ts';
import { clientAddress, getCookie } from '../http/context.ts';
import { HttpError, forbidden } from '../lib/errors.ts';
import { findUserByApiToken, findUserByEmail, type UserRow } from '../models/users.ts';
import { safeEqual, verifyAgainstDummy, verifyPassword } from './crypto.ts';
import { findSessionUser, SESSION_COOKIE } from './sessions.ts';

export const CSRF_HEADER = 'x-timetrack-csrf';

function decodeBasic(header: string): { username: string; password: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

async function userFromBasic(deps: Deps, req: Request, header: string): Promise<UserRow> {
  const credentials = decodeBasic(header);
  if (!credentials) throw forbidden('Incorrect username and/or password');

  // API tokens are 128-bit random values, so only password attempts are rate limited.
  if (credentials.password === 'api_token') {
    const candidate = findUserByApiToken(deps.db, credentials.username);
    if (candidate && safeEqual(candidate.api_token, credentials.username)) return candidate;
    throw forbidden('Incorrect username and/or password');
  }

  const candidate = findUserByEmail(deps.db, credentials.username);
  const valid = await deps.loginLimiter.attempt(clientAddress(req), () => (candidate
    ? verifyPassword(credentials.password, candidate.password_hash)
    : verifyAgainstDummy(credentials.password)));
  if (valid === null) throw new HttpError(429, 'Too many failed login attempts, try again later');
  if (candidate && valid) return candidate;
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
    const token = getCookie(req, SESSION_COOKIE);
    const user = token ? findSessionUser(deps.db, token) : undefined;
    if (!user) throw forbidden('Incorrect username and/or password');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw forbidden('Missing CSRF header');
    }
    res.locals.user = user;
    res.locals.authMethod = 'session';
    return next();
  };
}
