import type { Request, RequestHandler } from 'express';
import type { AccountPasswordAttempt, AccountRepositories, AccountRunner } from '../domain/accounts.ts';
import {
  credentialHolds,
  currentCredentialUser as credentialUser,
  findActiveSession,
  isActiveAdmin,
  isActiveUser,
  unchangedActive,
  type AccountCredential,
} from '../domain/credentials.ts';
import type { User } from '../storage/domain.ts';
import type { Repositories } from '../storage/contracts.ts';
import { clientAddress, getCookie } from '../http/context.ts';
import { forbidden, tooManyAttempts } from '../lib/errors.ts';
import { safeEqual, verifyAgainstDummy, verifyPassword } from '../lib/crypto.ts';
import { passwordCounters, type FailureLimiter } from './rateLimit.ts';

export const SESSION_COOKIE = 'tokkl_session';
export const LEGACY_SESSION_COOKIE = 'tt_session';
export const CSRF_HEADER = 'x-tokkl-csrf';
export const LEGACY_CSRF_HEADER = 'x-timetrack-csrf';

/** Keep the normalized user and the credential observed by this request together. */
export interface StorageAuthentication {
  user: User;
  credential: AccountCredential;
  authMethod: 'session' | 'basic';
}
export interface StorageAuthLocals {
  auth: StorageAuthentication;
}
export type StorageAuthHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Request['query'],
  StorageAuthLocals
>;

export function hasCsrfHeader(req: Request): boolean {
  return req.headers[CSRF_HEADER] === '1' || req.headers[LEGACY_CSRF_HEADER] === '1';
}
export function requireCsrfHeader(req: Request): void {
  if (!hasCsrfHeader(req)) throw forbidden('Missing CSRF header');
}
export function sessionTokens(req: Request): string[] {
  return [getCookie(req, SESSION_COOKIE), getCookie(req, LEGACY_SESSION_COOKIE)].filter(token => token !== undefined);
}
function decodeBasic(header: string) {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
export function passwordAttempt(limiter: FailureLimiter, email: string, address: string): AccountPasswordAttempt {
  const counters = passwordCounters(email, address);
  return { attempt: check => limiter.attempt(counters, check) };
}
/** Only callable through the shared password attempt policy, including unknown/disabled accounts. */
export async function authenticatePassword<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  limiter: FailureLimiter,
  email: string,
  password: string,
  address: string,
): Promise<User | undefined> {
  const seen = await runner.readSnapshot(ctx => ctx.users.findByEmail(email));
  const result = await passwordAttempt(limiter, email, address).attempt(async () => {
    if (!seen) return verifyAgainstDummy(password);
    return (await verifyPassword(password, seen.passwordHash)) && isActiveUser(seen);
  });
  if (result.refused) throw tooManyAttempts('Too many failed login attempts, try again later', result.retryAfter);
  if (!seen || !result.valid) return;
  return runner.readSnapshot(ctx => currentActiveUser(ctx, seen));
}
export async function currentActiveUser(ctx: Pick<Repositories, 'users'>, seen: User): Promise<User | undefined> {
  const current = await ctx.users.get(seen.id);
  return unchangedActive(current, seen) ? current : undefined;
}
/** Check credentials in the data snapshot for reads, or under the operation's guards for writes. */
export function currentCredentialUser(
  ctx: Pick<Repositories, 'users' | 'sessions'>,
  auth: StorageAuthentication,
): Promise<User | undefined> {
  return credentialUser(ctx, auth.user, auth.credential);
}
/** A passing stream check carries the user's timer revision, read by the same user statement. */
export type StreamCredentialResult = { valid: false } | { valid: true; revision: number };
async function currentCredentialRevision(
  ctx: Pick<Repositories, 'users' | 'sessions'>,
  auth: StorageAuthentication,
): Promise<StreamCredentialResult> {
  const current = await ctx.users.getWithTimerRevision(auth.user.id);
  return current && (await credentialHolds(ctx, auth.user, auth.credential, current.user))
    ? { valid: true, revision: current.timerRevision }
    : { valid: false };
}
/** Independent async stream port. Storage failures fail closed and never reject a keep-alive callback. */
export function credentialCheck<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  auth: StorageAuthentication,
): () => Promise<StreamCredentialResult> {
  // Capture fingerprints now, even if HTTP locals are replaced after a profile update.
  const observed = { ...auth, user: { ...auth.user }, credential: { ...auth.credential } };
  return async () => {
    try {
      return await runner.readSnapshot(ctx => currentCredentialRevision(ctx, observed));
    } catch {
      return { valid: false };
    }
  };
}
export function createStorageAuth<R extends AccountRepositories>(runner: AccountRunner<R>, limiter: FailureLimiter) {
  const authenticate = async (req: Request): Promise<StorageAuthentication> => {
    const header = req.headers.authorization;
    if (header) {
      const decoded = decodeBasic(header);
      if (!decoded) throw forbidden('Incorrect username and/or password');
      if (decoded.password === 'api_token') {
        const user = await runner.readSnapshot(ctx => ctx.users.findByApiToken(decoded.username));
        if (isActiveUser(user) && safeEqual(user.apiToken, decoded.username)) {
          return { user, credential: { kind: 'api-token', token: decoded.username }, authMethod: 'basic' };
        }
      } else {
        const user = await authenticatePassword(
          runner,
          limiter,
          decoded.username,
          decoded.password,
          clientAddress(req),
        );
        if (user) return { user, credential: { kind: 'password' }, authMethod: 'basic' };
      }
      throw forbidden('Incorrect username and/or password');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireCsrfHeader(req);
    const auth = await runner.readSnapshot(async ctx => {
      for (const token of sessionTokens(req)) {
        const found = await findActiveSession(ctx, token);
        if (found)
          return { user: found.user, credential: { kind: 'session' as const, token }, authMethod: 'session' as const };
      }
    });
    if (!auth) throw forbidden('Incorrect username and/or password');
    return auth;
  };
  const requireAuth: StorageAuthHandler = async (req, res, next) => {
    res.locals.auth = await authenticate(req);
    return next();
  };
  const requireAdmin: StorageAuthHandler = (_req, res, next) => {
    if (!res.locals.auth || !isActiveAdmin(res.locals.auth.user)) throw forbidden('Admin access required');
    return next();
  };
  return {
    authenticate,
    requireAuth,
    requireAdmin,
    credentialCheck: (auth: StorageAuthentication) => credentialCheck(runner, auth),
  };
}
