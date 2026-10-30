import type { Request, RequestHandler, Response } from 'express';
import type { AccountEntryEffects, AccountRepositories, AccountRunner, createAccountOperations } from '../domain/accounts.ts';
import { findResetUser, findUsableInvite, INVITE_NOT_FOUND, RESET_NOT_FOUND } from '../domain/accounts.ts';
import type { User } from '../storage/domain.ts';
import { clientAddress, readJson } from '../http/context.ts';
import { forbidden, notFound, tooManyRequests } from '../lib/errors.ts';
import { safeEqual } from './crypto.ts';
import { accountCounters, addressCounter, type FailureLimiter } from './rateLimit.ts';
import {
  authenticatePassword, hasCsrfHeader, LEGACY_SESSION_COOKIE, passwordAttempt,
  requireCsrfHeader, SESSION_COOKIE, sessionTokens, type StorageAuthentication,
} from './storageMiddleware.ts';

export interface StorageSessionOptions {
  loginLimiter: FailureLimiter;
  setupLimiter: FailureLimiter;
  sessionDays: number;
  setup: { code: string | null };
}
/** Session HTTP adapters over the guarded account operations. */
export function createStorageSessions<R extends AccountRepositories>(
  runner: AccountRunner<R>, operations: ReturnType<typeof createAccountOperations<R>>, options: StorageSessionOptions,
) {
  const { loginLimiter, setupLimiter, setup } = options;
  const startSession = async (req: Request, res: Response, user: User) => {
    // The domain operation rechecks the observed password/active status under its write guards.
    const session = await operations.createSession(user, req.get('user-agent') ?? '', options.sessionDays);
    res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', expires: session.expires });
    res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
  };
  const linkCounter = (req: Request) => {
    const counter = addressCounter(clientAddress(req));
    if (loginLimiter.isBlocked(counter)) throw tooManyRequests('Too many failed attempts, try again later', loginLimiter.retryAfterSeconds(counter));
    return counter;
  };
  const inviteFor = async (req: Request) => {
    const counter = linkCounter(req), token = String(req.params.token);
    const invite = await runner.readSnapshot(ctx => findUsableInvite(ctx, token));
    if (!invite?.role) { loginLimiter.recordFailure(counter); throw notFound(INVITE_NOT_FOUND); }
    return { token, role: invite.role };
  };
  const resetFor = async (req: Request) => {
    const counter = linkCounter(req), token = String(req.params.token);
    const user = await runner.readSnapshot(ctx => findResetUser(ctx, token));
    if (!user) { loginLimiter.recordFailure(counter); throw notFound(RESET_NOT_FOUND); }
    return { token, user };
  };
  const status: RequestHandler = async (_req, res) => res.json({ setup_required: await runner.readSnapshot(ctx => ctx.users.count()) === 0 });
  const login: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const body = readJson(req), address = clientAddress(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await authenticatePassword(runner, loginLimiter, email, password, address);
    if (!user) throw forbidden('Incorrect email or password');
    await startSession(req, res, user);
    loginLimiter.reset(accountCounters(email, address));
    return res.json({ ok: true });
  };
  const firstAdmin: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    if (await runner.readSnapshot(ctx => ctx.users.count()) > 0 || setup.code === null) throw forbidden('Setup has already been completed');
    const address = clientAddress(req);
    if (setupLimiter.isBlocked(address)) throw tooManyRequests('Too many failed attempts, try again later', setupLimiter.retryAfterSeconds(address));
    const body = readJson(req);
    if (typeof body.setup_code !== 'string' || !safeEqual(body.setup_code.trim(), setup.code)) {
      setupLimiter.recordFailure(address);
      throw forbidden('Invalid setup code. It is printed in the server log on startup.');
    }
    const user = await operations.createFirstAdmin(body);
    setup.code = null;
    await startSession(req, res, user);
    return res.json({ ok: true });
  };
  const inviteInfo: RequestHandler = async (req, res) => res.json({ role: (await inviteFor(req)).role });
  const acceptInvite: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const { token } = await inviteFor(req);
    const user = await operations.acceptInvite(token, readJson(req));
    await startSession(req, res, user);
    return res.json({ ok: true });
  };
  const resetInfo: RequestHandler = async (req, res) => res.json({ email: (await resetFor(req)).user.email });
  const resetPassword: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const { token, user } = await resetFor(req);
    await operations.resetPassword(token, readJson(req).password);
    loginLimiter.reset(accountCounters(user.email, clientAddress(req)));
    return res.json({ ok: true });
  };
  const logout: RequestHandler = async (req, res) => {
    // Logout is idempotent without a live cookie, so this one path must discover live sessions first.
    const active = [];
    for (const token of sessionTokens(req)) if (await operations.findSessionUser(token)) active.push(token);
    if (active.length && !hasCsrfHeader(req)) throw forbidden('Missing CSRF header');
    for (const token of active) await operations.deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
    return res.json({ ok: true });
  };
  const updateProfile = (req: Request, auth: StorageAuthentication, body: Record<string, unknown>, effects: AccountEntryEffects<R>) =>
    operations.updateProfile(auth.user, auth.credential, body, effects, passwordAttempt(loginLimiter, auth.user.email, clientAddress(req)));
  return { status, login, firstAdmin, inviteInfo, acceptInvite, resetInfo, resetPassword, logout, startSession, updateProfile };
}
