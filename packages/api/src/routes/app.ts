import { type Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { jsonRead } from './context.ts';
import { query } from '../http/params.ts';
import { notFound } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { dateKey } from '@tokkl/common/time';
import { serializeTimeEntry } from '../presenters/toggl.ts';
import { parseEntrySplit } from '../commands/timeEntries.ts';
import { readIdempotencyClaim, readJson } from '../http/request.ts';
import { streamDownload } from '../http/download.ts';
import { getPreferences } from '../domain/accountValues.ts';
import { parsePreferenceChanges } from '../commands/accounts.ts';
import { presentPomodoroLimits, presentServerApi } from '../presenters/serverApi.ts';
import type { AppStatus, CatalogRevision, TrashTotal } from '@tokkl/types';
import { TRASH_READ_LIMIT } from '../domain/ports.ts';

type AppRouteDeps = Pick<Deps, 'auth' | 'sessions' | 'readFor' | 'entriesFor' | 'exportAccount' | 'preferencesFor'>;

export function appRoutes(deps: AppRouteDeps): Router {
  const { sessions } = deps;
  const app = createRouter(),
    auth = deps.auth.requireAuth;
  // Clients pick routes from the API version and capabilities, never from a 404.
  app.get('/status', async (_req, res) => {
    const status: AppStatus = {
      ...(await sessions.status()),
      ...presentServerApi(),
      pomodoro_limits: presentPomodoroLimits(),
    };
    res.json(status);
  });
  app.post('/setup', sessions.firstAdmin);
  app.get('/invites/:token', sessions.inviteInfo);
  app.post('/invites/:token', sessions.acceptInvite);
  app.get('/password-resets/:token', sessions.resetInfo);
  app.post('/password-resets/:token', sessions.resetPassword);
  app.post('/login', sessions.login);
  app.post('/logout', sessions.logout);
  // Same as the v9 `/me/preferences`, plus the /api/app validation headers.
  app.get(
    '/me/preferences',
    auth,
    jsonRead(deps, (_req, res) => getPreferences(res.locals.auth.user)),
  );
  app.post('/me/preferences', auth, async (req, res) => {
    const changes = parsePreferenceChanges(readJson(req));
    res.json(await deps.preferencesFor(res.locals.auth).savePreferences(changes));
  });
  app.post('/time_entries/:id/restore', auth, async (req, res) => {
    const entry = await deps.entriesFor(res.locals.auth).restore(parseId(req.params.id));
    return res.json(serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }));
  });
  // Both halves or neither.
  app.post('/time_entries/:id/split', auth, async (req, res) => {
    const id = parseId(req.params.id);
    const split = parseEntrySplit(readJson(req));
    const { first, second } = await deps.entriesFor(res.locals.auth).split(id, split, readIdempotencyClaim(req));
    const presentation = { meta: true, user: res.locals.auth.user };
    return res.json({
      first: serializeTimeEntry(first, presentation),
      second: serializeTimeEntry(second, presentation),
    });
  });
  app.get(
    '/workspaces/:wid/catalog',
    auth,
    jsonRead(deps, async (req, res, queries): Promise<CatalogRevision> => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      return { revision: await queries.catalogRevision(ws) };
    }),
  );
  // As `/me/time_entries?meta=true` lists it.
  app.get(
    '/time_entries/latest',
    auth,
    jsonRead(deps, async (_req, res, queries) => {
      const entry = await queries.latestEntry(res.locals.auth.user.id);
      return entry ? serializeTimeEntry(entry, { meta: true, user: res.locals.auth.user }) : null;
    }),
  );
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
  // The trash read stops at TRASH_READ_LIMIT; this says how many there are.
  app.get(
    '/trash/total',
    auth,
    jsonRead(deps, async (_req, res, queries): Promise<TrashTotal> => ({
      total: await queries.trashTotal(res.locals.auth.user.id),
      limit: TRASH_READ_LIMIT,
    })),
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
  // Headers go out with the first piece, after the credential and range checks.
  app.get('/export.json', auth, async (_req, res) => {
    const instant = new Date().toISOString();
    const filename = `tokkl-${instant.slice(0, 10)}.json`;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };
    await streamDownload(res, headers, output =>
      deps.exportAccount(res.locals.auth, { kind: 'export-json', exportedAt: instant, filename }, output, {
        signal: res.locals.workSignal,
      }),
    );
  });
  app.get('/export.csv', auth, async (req, res) => {
    const filename = `tokkl-entries-${new Date().toISOString().slice(0, 10)}.csv`;
    const assembly = {
      kind: 'export-csv',
      range: { from: query(req, 'start_date'), to: query(req, 'end_date') },
      filename,
      durationFormat: 'improved',
    } as const;
    const headers = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    };
    await streamDownload(res, headers, output =>
      deps.exportAccount(res.locals.auth, assembly, output, { signal: res.locals.workSignal }),
    );
  });
  return app;
}
