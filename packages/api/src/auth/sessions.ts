import type { Request, RequestHandler, Response } from 'express';
import type { AccountRepositories, AccountRunner } from '../domain/accountGuards.ts';
import type { createAccountOperations } from '../domain/accounts.ts';
import { findResetUser, findUsableInvite, INVITE_NOT_FOUND, RESET_NOT_FOUND } from '../domain/accountLinks.ts';
import { getInstanceSettings, signupEffective } from '../domain/instanceSettings.ts';
import { parseNewAccount, parseNewPassword } from '../commands/accounts.ts';
import type { User } from '../domain/model.ts';
import { clientAddress, readJson } from '../http/request.ts';
import { forbidden, notFound, tooManyAttempts } from '../lib/errors.ts';
import { safeEqual } from '../lib/crypto.ts';
import { accountCounters, addressCounter, type FailureLimiter } from './rateLimit.ts';
import {
  authenticatePassword,
  hasCsrfHeader,
  LEGACY_SESSION_COOKIE,
  requireCsrfHeader,
  SESSION_COOKIE,
  sessionTokens,
} from './middleware.ts';

/** `null` once the first admin exists or none was printed. */
export interface SetupState {
  code: string | null;
}
interface SessionOptions {
  loginLimiter: FailureLimiter;
  setupLimiter: FailureLimiter;
  sessionDays: number;
  mailConfigured: boolean;
  setup: SetupState;
}
export function createSessionHandlers<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  operations: ReturnType<typeof createAccountOperations<R>>,
  options: SessionOptions,
) {
  const { loginLimiter, setupLimiter, setup } = options;
  const startSession = async (req: Request, res: Response, user: User) => {
    // The domain operation rechecks the observed password/active status under its write guards.
    const session = await operations.createSession(user, req.get('user-agent') ?? '', options.sessionDays);
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      expires: session.expires,
    });
    res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
  };
  /** The lookup holds a slot like a password check, so parallel bad links cannot pass the limit. */
  const linked = async <T>(req: Request, find: (token: string) => Promise<T | undefined>, missing: string) => {
    const token = String(req.params.token);
    let found: T | undefined;
    const result = await loginLimiter.attempt(
      addressCounter(clientAddress(req)),
      async () => (found = await find(token)) !== undefined,
    );
    if (result.refused) throw tooManyAttempts('Too many failed attempts, try again later', result.retryAfter);
    if (found === undefined) throw notFound(missing);
    return { token, found };
  };
  const inviteFor = async (req: Request) => {
    const { token, found: invite } = await linked(
      req,
      async token => {
        const invite = await runner.readSnapshot(ctx => findUsableInvite(ctx, token));
        return invite?.role ? invite : undefined;
      },
      INVITE_NOT_FOUND,
    );
    return { token, role: invite.role!, email: invite.email };
  };
  const resetFor = async (req: Request) => {
    const { token, found: user } = await linked(
      req,
      token => runner.readSnapshot(ctx => findResetUser(ctx, token)),
      RESET_NOT_FOUND,
    );
    return { token, user };
  };
  const status = () =>
    runner.readSnapshot(async ctx => ({
      setup_required: (await ctx.users.count()) === 0,
      signup_enabled: signupEffective(await getInstanceSettings(ctx, options.sessionDays), options.mailConfigured),
    }));
  const login: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const body = readJson(req),
      address = clientAddress(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await authenticatePassword(runner, loginLimiter, email, password, address);
    if (!user) throw forbidden('Incorrect email or password');
    await startSession(req, res, user);
    await loginLimiter.reset(accountCounters(email, address));
    return res.json({ ok: true });
  };
  const firstAdmin: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    if ((await runner.readSnapshot(ctx => ctx.users.count())) > 0 || setup.code === null)
      throw forbidden('Setup has already been completed');
    const code = setup.code;
    let body: ReturnType<typeof readJson> = {};
    // The comparison holds a slot, so parallel wrong codes cannot pass the limit.
    const result = await setupLimiter.attempt(clientAddress(req), async () => {
      body = readJson(req);
      return typeof body.setup_code === 'string' && safeEqual(body.setup_code.trim(), code);
    });
    if (result.refused) throw tooManyAttempts('Too many failed attempts, try again later', result.retryAfter);
    if (!result.valid) throw forbidden('Invalid setup code. It is printed in the server log on startup.');
    const user = await operations.createFirstAdmin(parseNewAccount(body));
    setup.code = null;
    await startSession(req, res, user);
    return res.json({ ok: true });
  };
  const inviteInfo: RequestHandler = async (req, res) => {
    const { role, email } = await inviteFor(req);
    return res.json({ role, ...(email === null ? {} : { email }) });
  };
  const acceptInvite: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const { token, email } = await inviteFor(req);
    const body = readJson(req);
    const user = await operations.acceptInvite(token, parseNewAccount({ ...body, email: email ?? body.email }));
    await startSession(req, res, user);
    return res.json({ ok: true });
  };
  const resetInfo: RequestHandler = async (req, res) => res.json({ email: (await resetFor(req)).user.email });
  const resetPassword: RequestHandler = async (req, res) => {
    requireCsrfHeader(req);
    const { token, user } = await resetFor(req);
    await operations.resetPassword(token, parseNewPassword(readJson(req).password));
    await loginLimiter.reset(accountCounters(user.email, clientAddress(req)));
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
  return {
    status,
    login,
    firstAdmin,
    inviteInfo,
    acceptInvite,
    resetInfo,
    resetPassword,
    logout,
  };
}
export type SessionHandlers = ReturnType<typeof createSessionHandlers>;
