import { type Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { jsonRead } from './context.ts';
import { readText } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { invalidInput, notFound } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { dateKey } from '@tokkl/common/time';
import { serializeTimeEntry } from '../presenters/toggl.ts';

export type AppRouteDeps = Pick<Deps, 'auth' | 'sessions' | 'readFor' | 'entriesFor' | 'exportAccount' | 'importsFor'>;

export function appRoutes(deps: AppRouteDeps): Router {
  const { sessions } = deps;
  const app = createRouter(),
    auth = deps.auth.requireAuth;
  app.get('/status', sessions.status);
  app.post('/setup', sessions.firstAdmin);
  app.get('/invites/:token', sessions.inviteInfo);
  app.post('/invites/:token', sessions.acceptInvite);
  app.get('/password-resets/:token', sessions.resetInfo);
  app.post('/password-resets/:token', sessions.resetPassword);
  app.post('/login', sessions.login);
  app.post('/logout', sessions.logout);
  app.post('/time_entries/:id/restore', auth, async (req, res) => {
    const entry = await deps.entriesFor(res.locals.auth).restore(parseId(req.params.id));
    return res.json(serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }));
  });
  app.get(
    '/bounds',
    auth,
    jsonRead(deps, async (_req, res, queries) => {
      const user = res.locals.auth.user,
        row = await queries.entryBounds(user.id);
      return {
        first_date: row.firstStart ? dateKey(new Date(row.firstStart), user.timezone) : null,
        last_date: row.lastStart ? dateKey(new Date(row.lastStart), user.timezone) : null,
      };
    }),
  );
  app.get(
    '/trash',
    auth,
    jsonRead(deps, async (_req, res, queries) =>
      (await queries.trash(res.locals.auth.user.id)).map(entry =>
        serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }),
      ),
    ),
  );
  app.delete('/trash', auth, async (_req, res) =>
    res.json({
      deleted: await deps.entriesFor(res.locals.auth).purgeTrash(),
    }),
  );
  app.delete('/trash/:id', auth, async (req, res) => {
    const deleted = await deps.entriesFor(res.locals.auth).purgeTrash(parseId(req.params.id));
    if (!deleted) throw notFound('Time entry not found in trash');
    return res.json({ deleted });
  });
  app.get('/export.json', auth, async (_req, res) => {
    const instant = new Date().toISOString();
    const result = await deps.exportAccount(
      res.locals.auth,
      { kind: 'export-json', exportedAt: instant, filename: `tokkl-${instant.slice(0, 10)}.json` },
      { signal: res.locals.workSignal },
    );
    res
      .set(result.headers)
      .type('json')
      .set('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.body);
  });
  app.get('/export.csv', auth, async (req, res) => {
    const result = await deps.exportAccount(
      res.locals.auth,
      {
        kind: 'export-csv',
        range: { from: query(req, 'start_date'), to: query(req, 'end_date') },
        filename: `tokkl-entries-${new Date().toISOString().slice(0, 10)}.csv`,
        durationFormat: 'improved',
      },
      { signal: res.locals.workSignal },
    );
    res
      .set(result.headers)
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.body);
  });
  app.post('/import/toggl-csv', auth, async (req, res) => {
    const text = readText(req);
    if (!text.trim()) throw invalidInput('The file is empty');
    // One `user=<key>` per selected Toggl user; keys may hold commas, so they are never joined.
    const users = queryList(req, 'user');
    if (users?.length === 0) throw invalidInput('Invalid user selection');
    return res.json(
      await deps
        .importsFor(res.locals.auth)
        .importTogglCsv(res.locals.auth.user.id, text, { dryRun: query(req, 'dry_run') === 'true', users }),
    );
  });
  app.post('/import/json', auth, async (req, res) => {
    let data: unknown;
    try {
      data = JSON.parse(readText(req));
    } catch {
      throw invalidInput('The file is not valid JSON');
    }
    return res.json(
      await deps
        .importsFor(res.locals.auth)
        .importJsonExport(res.locals.auth.user.id, data, { dryRun: query(req, 'dry_run') === 'true' }),
    );
  });
  return app;
}
