import type { Router } from 'express';
import type { Deps } from '../../http/context.ts';
import { readJson, readJsonArray } from '../../http/context.ts';
import { createRouter } from '../../http/router.ts';
import { parseId, parseIdList } from '../../lib/values.ts';
import { parseEntryChanges, parseEntryPatch, parseNewEntry, parseStopAt } from '../../commands/timeEntries.ts';
import {
  createTimeEntry,
  deleteTimeEntry,
  patchTimeEntries,
  stopTimeEntry,
  updateTimeEntry,
} from '../../domain/timeEntries.ts';
import { serializeTimeEntry } from '../../presenters/toggl.ts';
import { authorizedWorkspace, entryPresentation } from './shared.ts';

/** Time entry writes in a workspace. Reads are under `/me/time_entries`. */
export function timeEntryRoutes(deps: Deps): Router {
  const api = createRouter();
  api.post('/workspaces/:wid/time_entries', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const entry = parseNewEntry(readJson(req));
    const created = await deps.entryWrite(res.locals.auth, ctx =>
      createTimeEntry(ctx, res.locals.auth.user, ws.id, entry, deps.publish),
    );
    res.json(serializeTimeEntry(created, entryPresentation(req, res)));
  });
  api.put('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const id = parseId(req.params.id);
    const changes = parseEntryChanges(readJson(req));
    const entry = await deps.entryWrite(res.locals.auth, ctx =>
      updateTimeEntry(ctx, res.locals.auth.user, ws.id, id, changes, deps.publish),
    );
    res.json(serializeTimeEntry(entry, entryPresentation(req, res)));
  });
  api.patch('/workspaces/:wid/time_entries/:id/stop', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    // The body is optional; when present it may carry the stop instant.
    const body = req.body ? readJson(req) : undefined;
    const id = parseId(req.params.id);
    const stop = parseStopAt(body);
    const entry = await deps.entryWrite(res.locals.auth, ctx =>
      stopTimeEntry(ctx, res.locals.auth.user, ws.id, id, deps.publish, stop),
    );
    res.json(serializeTimeEntry(entry, entryPresentation(req, res)));
  });
  api.patch('/workspaces/:wid/time_entries/:ids', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const ids = parseIdList(req.params.ids);
    const steps = parseEntryPatch(readJsonArray(req));
    res.json(
      await deps.entryWrite(res.locals.auth, ctx =>
        patchTimeEntries(ctx, res.locals.auth.user, ws.id, ids, steps, deps.publish),
      ),
    );
  });
  api.delete('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    await deps.entryWrite(res.locals.auth, ctx =>
      deleteTimeEntry(ctx, res.locals.auth.user.id, ws.id, parseId(req.params.id), deps.publish),
    );
    res.status(200).end();
  });
  return api;
}
