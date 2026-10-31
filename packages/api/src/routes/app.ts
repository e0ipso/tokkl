import express, { type Router } from 'express';
import type { Deps } from '../http/context.ts';
import { jsonRead, query, readText } from '../http/context.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { dateKey } from '@tokkl/common/time';
import { createStorageSessions } from '../auth/storageSessions.ts';
import { restoreTimeEntry, purgeDeletedEntries, serializeTimeEntry } from '../domain/timeEntries.ts';
export interface SetupState {
  code: string | null;
}
export function appRoutes(deps: Deps, setup: SetupState): Router {
  const { storage, config, accounts, loginLimiter, setupLimiter } = deps;
  const app = express.Router(), auth = deps.auth.requireAuth;
  const sessions = createStorageSessions(storage, accounts, { loginLimiter, setupLimiter, sessionDays: config.sessionDays, setup });
  app.get('/status', sessions.status);
  app.post('/setup', sessions.firstAdmin);
  app.get('/invites/:token', sessions.inviteInfo);
  app.post('/invites/:token', sessions.acceptInvite);
  app.get('/password-resets/:token', sessions.resetInfo);
  app.post('/password-resets/:token', sessions.resetPassword);
  app.post('/login', sessions.login);
  app.post('/logout', sessions.logout);
  app.post('/time_entries/:id/restore', auth, async (req, res) => {
    const entry = await deps.entryWrite(res.locals.auth, ctx => restoreTimeEntry(ctx, res.locals.auth.user, parseId(req.params.id), deps.publish));
    return res.json(serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }));
  });
  app.get('/bounds', auth, jsonRead(deps, async (_req, res, db) => {
    const user = res.locals.auth.user, row = await db.entries.bounds(user.id);
    return { first_date: row.firstStart ? dateKey(new Date(row.firstStart), user.timezone) : null, last_date: row.lastStart ? dateKey(new Date(row.lastStart), user.timezone) : null };
  }));
  app.get('/trash', auth, jsonRead(deps, async (_req, res, db) => (await db.entries.listDeleted(res.locals.auth.user.id)).map(entry => serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }))));
  app.delete('/trash', auth, async (_req, res) => res.json({ deleted: await deps.entryWrite(res.locals.auth, ctx => purgeDeletedEntries(ctx, res.locals.auth.user.id, deps.publish)) }));
  app.delete('/trash/:id', auth, async (req, res) => {
    const deleted = await deps.entryWrite(res.locals.auth, ctx => purgeDeletedEntries(ctx, res.locals.auth.user.id, deps.publish, parseId(req.params.id)));
    if (!deleted)
      throw notFound('Time entry not found in trash');
    return res.json({ deleted });
  });
  app.get('/export.json', auth, async (_req, res) => {
    const instant = new Date().toISOString();
    const data = await deps.readFor(res.locals.auth, db => db.transfers.exportAccount(res.locals.auth.user.id));
    const result = await deps.reports.assembleExport(data, { kind: 'export-json', exportedAt: instant, filename: `tokkl-${instant.slice(0, 10)}.json` }, { signal: res.locals.workSignal });
    res.set(result.headers).type('json').set('Content-Disposition', `attachment; filename="${result.filename}"`).send(result.body);
  });
  app.get('/export.csv', auth, async (req, res) => {
    const data = await deps.readFor(res.locals.auth, db => db.transfers.exportAccount(res.locals.auth.user.id));
    const result = await deps.reports.assembleExport(data, { kind: 'export-csv', range: { from: query(req, 'start_date'), to: query(req, 'end_date') }, filename: `tokkl-entries-${new Date().toISOString().slice(0, 10)}.csv`, durationFormat: 'improved' }, { signal: res.locals.workSignal });
    res.set(result.headers).set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${result.filename}"`).send(result.body);
  });
  app.post('/import/toggl-csv', auth, async (req, res) => {
    const text = readText(req);
    if (!text.trim())
      throw badRequest('The file is empty');
    const selected = req.query.user, users = selected === undefined ? undefined : [selected].flat().filter(key => typeof key === 'string');
    if (users?.length === 0)
      throw badRequest('Invalid user selection');
    return res.json(await deps.importsFor(res.locals.auth).importTogglCsv(res.locals.auth.user.id, text, { dryRun: query(req, 'dry_run') === 'true', users }));
  });
  app.post('/import/json', auth, async (req, res) => {
    let data: unknown;
    try {
      data = JSON.parse(readText(req));
    }
    catch {
      throw badRequest('The file is not valid JSON');
    }
    return res.json(await deps.importsFor(res.locals.auth).importJsonExport(res.locals.auth.user.id, data, { dryRun: query(req, 'dry_run') === 'true' }));
  });
  return app;
}
