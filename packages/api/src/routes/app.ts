import express, { type Request, type Response, type Router } from 'express';
import { MAX_PASSWORD_LENGTH, safeEqual, verifyAgainstDummy, verifyPassword } from '../auth/crypto.ts';
import { accountCounters, passwordCounters } from '../auth/rateLimit.ts';
import { hasCsrfHeader, requireAuth, sessionTokens } from '../auth/middleware.ts';
import { createSession, deleteSession, findSessionUser, LEGACY_SESSION_COOKIE, SESSION_COOKIE } from '../auth/sessions.ts';
import type { Deps } from '../http/context.ts';
import { clientAddress, query, readJson, readText } from '../http/context.ts';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { dateKey, isValidTimeZone } from '@tokkl/common/time';
import {
  listDeletedEntries, purgeDeletedEntries, restoreTimeEntry, serializeTimeEntry,
} from '../models/timeEntries.ts';
import { countUsers, createOwner, findUserByEmail } from '../models/users.ts';
import { buildCsvExport, buildJsonExport } from '../services/export.ts';
import { importTogglCsv } from '../services/importCsv.ts';
import { importJsonExport } from '../services/importJson.ts';

export interface SetupState {
  /** Code required to create the account; null once an account exists. */
  code: string | null;
}

function startSession(deps: Deps, req: Request, res: Response, userId: number): void {
  const { token, expires } = createSession(deps.db, userId, deps.config.sessionDays, req.get('user-agent') ?? '');
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

export function appRoutes(deps: Deps, setup: SetupState): Router {
  const { db, loginLimiter, setupLimiter } = deps;
  const app = express.Router();
  const auth = requireAuth(deps);

  app.get('/status', (req, res) => res.json({ setup_required: countUsers(db) === 0 }));

  app.post('/setup', async (req, res) => {
    if (countUsers(db) > 0 || setup.code === null) throw forbidden('Setup has already been completed');
    const address = clientAddress(req);
    if (setupLimiter.isBlocked(address)) throw new HttpError(429, 'Too many failed attempts, try again later');
    const body = readJson(req);
    if (typeof body.setup_code !== 'string' || !safeEqual(body.setup_code.trim(), setup.code)) {
      setupLimiter.recordFailure(address);
      throw forbidden('Invalid setup code. It is printed in the server log on startup.');
    }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fullname = typeof body.fullname === 'string' ? body.fullname.trim().slice(0, 255) : '';
    const timezone = typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : 'UTC';
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (password.length > MAX_PASSWORD_LENGTH) throw badRequest(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
    const user = await createOwner(db, { email, password, fullname, timezone });
    setup.code = null;
    startSession(deps, req, res, user.id);
    return res.json({ ok: true });
  });

  app.post('/login', async (req, res) => {
    const address = clientAddress(req);
    const body = readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = findUserByEmail(db, email);
    const valid = await loginLimiter.attempt(passwordCounters(email, address), () => (
      user ? verifyPassword(password, user.password_hash) : verifyAgainstDummy(password)
    ));
    if (valid === null) throw new HttpError(429, 'Too many failed login attempts, try again later');
    if (!user || !valid) throw forbidden('Incorrect email or password');
    // The address counter is left alone, so one account's success cannot clear failures against another.
    loginLimiter.reset(accountCounters(email, address));
    startSession(deps, req, res, user.id);
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
    return res.json(importTogglCsv(db, res.locals.user, text, { dryRun }));
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
