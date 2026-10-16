import express, { type Request, type Response, type Router } from 'express';
import { hashPassword, MAX_PASSWORD_LENGTH, safeEqual } from '../auth/crypto.ts';
import { accountCounters, addressCounter, passwordCounters } from '../auth/rateLimit.ts';
import { currentActiveUser, hasCsrfHeader, requireAuth, sessionTokens, verifyAccountPassword } from '../auth/middleware.ts';
import { createSession, deleteSession, findSessionUser, LEGACY_SESSION_COOKIE, SESSION_COOKIE } from '../auth/sessions.ts';
import type { Deps } from '../http/context.ts';
import { clientAddress, query, readJson, readText } from '../http/context.ts';
import { badRequest, forbidden, notFound, tooManyRequests } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { dateKey, isValidTimeZone } from '@tokkl/common/time';
import {
  listDeletedEntries, purgeDeletedEntries, restoreTimeEntry, serializeTimeEntry,
} from '../models/timeEntries.ts';
import { acceptInvite, findUsableInvite, INVITE_NOT_FOUND } from '../models/accountTokens.ts';
import { getInstanceSettings } from '../models/settings.ts';
import { countUsers, createFirstAdmin, findUserByEmail, type NewAccount } from '../models/users.ts';
import { buildCsvExport, buildJsonExport } from '../services/export.ts';
import { importTogglCsv } from '../services/importCsv.ts';
import { importJsonExport } from '../services/importJson.ts';

export interface SetupState {
  /** Code that creates the first admin; null once any account exists. */
  code: string | null;
}

function startSession(deps: Deps, req: Request, res: Response, userId: number): void {
  const days = getInstanceSettings(deps.db, deps.config).session_days;
  const { token, expires } = createSession(deps.db, userId, days, req.get('user-agent') ?? '');
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Behind the reverse proxy this follows X-Forwarded-Proto, so the cookie is Secure under HTTPS.
    secure: req.secure,
    path: '/',
    expires,
  });
  res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
}

/** Reads and checks the account fields of the setup and invite forms. Bad input is a 400. */
function readNewAccount(body: Record<string, unknown>): NewAccount {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fullname = typeof body.fullname === 'string' ? body.fullname.trim().slice(0, 255) : '';
  const timezone = typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : 'UTC';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (password.length > MAX_PASSWORD_LENGTH) throw badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  return { email, password, fullname, timezone };
}

export function appRoutes(deps: Deps, setup: SetupState): Router {
  const { db, loginLimiter, setupLimiter } = deps;
  const app = express.Router();
  const auth = requireAuth(deps);

  app.get('/status', (req, res) => res.json({ setup_required: countUsers(db) === 0 }));

  app.post('/setup', async (req, res) => {
    if (countUsers(db) > 0 || setup.code === null) throw forbidden('Setup has already been completed');
    const address = clientAddress(req);
    if (setupLimiter.isBlocked(address)) throw tooManyRequests('Too many failed attempts, try again later', setupLimiter.retryAfterSeconds(address));
    const body = readJson(req);
    if (typeof body.setup_code !== 'string' || !safeEqual(body.setup_code.trim(), setup.code)) {
      setupLimiter.recordFailure(address);
      throw forbidden('Invalid setup code. It is printed in the server log on startup.');
    }
    const user = await createFirstAdmin(db, readNewAccount(body));
    setup.code = null;
    startSession(deps, req, res, user.id);
    return res.json({ ok: true });
  });

  /**
   * The usable invite behind the URL token, or a 404 that is the same for unknown, expired, used and
   * revoked tokens. Each miss counts against the address, and a blocked address gets 429 before the
   * lookup, so tokens cannot be guessed at speed.
   */
  const inviteFor = (req: Request) => {
    const counter = addressCounter(clientAddress(req));
    if (loginLimiter.isBlocked(counter)) throw tooManyRequests('Too many failed attempts, try again later', loginLimiter.retryAfterSeconds(counter));
    const token = String(req.params.token);
    const invite = findUsableInvite(db, token);
    if (!invite?.role) {
      loginLimiter.recordFailure(counter);
      throw notFound(INVITE_NOT_FOUND);
    }
    return { token, role: invite.role };
  };

  app.get('/invites/:token', (req, res) => res.json({ role: inviteFor(req).role }));

  app.post('/invites/:token', async (req, res) => {
    const { token } = inviteFor(req);
    const { password, ...account } = readNewAccount(readJson(req));
    // scrypt runs before the transaction, which checks the invite again.
    const passwordHash = await hashPassword(password);
    const user = acceptInvite(db, token, { ...account, passwordHash });
    startSession(deps, req, res, user.id);
    return res.json({ ok: true });
  });

  app.post('/login', async (req, res) => {
    const address = clientAddress(req);
    const body = readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = findUserByEmail(db, email);
    const counters = passwordCounters(email, address);
    const valid = await loginLimiter.attempt(counters, () => verifyAccountPassword(user, password));
    if (valid === null) throw tooManyRequests('Too many failed login attempts, try again later', loginLimiter.retryAfterSeconds(counters));
    const account = user && valid ? currentActiveUser(db, user) : undefined;
    if (!account) throw forbidden('Incorrect email or password');
    // The address counter is left alone, so one account's success cannot clear failures against another.
    loginLimiter.reset(accountCounters(email, address));
    startSession(deps, req, res, account.id);
    return res.json({ ok: true });
  });

  // Ending an active session is a cookie-authenticated write, so it needs the CSRF header.
  // Without an active session there is nothing to protect and logout stays idempotent.
  app.post('/logout', (req, res) => {
    const active = sessionTokens(req).filter((token) => findSessionUser(db, token));
    if (active.length > 0 && !hasCsrfHeader(req)) throw forbidden('Missing CSRF header');
    for (const token of active) deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
    return res.json({ ok: true });
  });

  app.post('/time_entries/:id/restore', auth, (req, res) => {
    const entry = restoreTimeEntry(db, res.locals.user.id, parseId(req.params.id));
    return res.json(serializeTimeEntry(entry, { meta: true, user: res.locals.user }));
  });

  /** First and last day with an entry, in the account timezone. Used by the "All time" report preset. */
  app.get('/bounds', auth, (req, res) => {
    const user = res.locals.user;
    const row = db.prepare(
      'SELECT MIN(start) AS first, MAX(start) AS last FROM time_entries WHERE user_id = ? AND deleted_at IS NULL',
    ).get(user.id) as { first: string | null; last: string | null };
    return res.json({
      first_date: row.first ? dateKey(new Date(row.first), user.timezone) : null,
      last_date: row.last ? dateKey(new Date(row.last), user.timezone) : null,
    });
  });

  app.get('/trash', auth, (req, res) => {
    const user = res.locals.user;
    return res.json(listDeletedEntries(db, user.id).map((entry) => serializeTimeEntry(entry, { meta: true, user })));
  });

  app.delete('/trash', auth, (req, res) => res.json({ deleted: purgeDeletedEntries(db, res.locals.user.id) }));

  app.delete('/trash/:id', auth, (req, res) => {
    const deleted = purgeDeletedEntries(db, res.locals.user.id, parseId(req.params.id));
    if (deleted === 0) throw notFound('Time entry not found in trash');
    return res.json({ deleted });
  });

  app.get('/export.json', auth, (req, res) => {
    res.set('Content-Disposition', `attachment; filename="tokkl-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.json(buildJsonExport(db, res.locals.user));
  });

  app.get('/export.csv', auth, (req, res) => {
    const from = query(req, 'start_date');
    const to = query(req, 'end_date');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="tokkl-entries-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(buildCsvExport(db, res.locals.user, { from, to }));
  });

  app.post('/import/toggl-csv', auth, async (req, res) => {
    const text = readText(req);
    if (!text.trim()) throw badRequest('The file is empty');
    const dryRun = query(req, 'dry_run') === 'true';
    // Repeat `user` once per selected Toggl user; keys can hold commas, so no comma list.
    const selected = req.query.user;
    const users = selected === undefined ? undefined : [selected].flat().filter((key) => typeof key === 'string');
    if (users?.length === 0) throw badRequest('Invalid user selection');
    return res.json(importTogglCsv(db, res.locals.user, text, { dryRun, users }));
  });

  app.post('/import/json', auth, async (req, res) => {
    let data: unknown;
    try {
      data = JSON.parse(readText(req));
    } catch {
      throw badRequest('The file is not valid JSON');
    }
    const dryRun = query(req, 'dry_run') === 'true';
    return res.json(importJsonExport(db, res.locals.user, data, { dryRun }));
  });

  return app;
}
