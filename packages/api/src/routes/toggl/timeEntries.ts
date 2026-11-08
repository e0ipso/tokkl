import type { Router } from 'express';
import type { Deps } from '../context.ts';
import { readIdempotencyClaim, readJson, readJsonArray } from '../../http/request.ts';
import { createRouter } from '../../http/router.ts';
import { parseId, parseIdList } from '../../lib/values.ts';
import { parseEntryChanges, parseEntryPatch, parseNewEntry, parseStopAt } from '../../commands/timeEntries.ts';
import { serializeTimeEntry } from '../../presenters/toggl.ts';
import { authorizedWorkspace, entryPresentation } from './shared.ts';

/** Time entry writes in a workspace. Reads are under `/me/time_entries`. */
export function timeEntryRoutes(deps: Pick<Deps, 'readFor' | 'entriesFor'>): Router {
  const api = createRouter();
  api.post('/workspaces/:wid/time_entries', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const entry = parseNewEntry(readJson(req));
    const created = await deps.entriesFor(res.locals.auth).create(ws.id, entry, readIdempotencyClaim(req));
    res.json(serializeTimeEntry(created, entryPresentation(req, res)));
  });
  api.put('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const id = parseId(req.params.id);
    const changes = parseEntryChanges(readJson(req));
    const entry = await deps.entriesFor(res.locals.auth).update(ws.id, id, changes);
    res.json(serializeTimeEntry(entry, entryPresentation(req, res)));
  });
  api.patch('/workspaces/:wid/time_entries/:id/stop', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    // The body is optional; when present it may carry the stop instant.
    const body = req.body ? readJson(req) : undefined;
    const id = parseId(req.params.id);
    const stop = parseStopAt(body);
    const entry = await deps.entriesFor(res.locals.auth).stop(ws.id, id, stop);
    res.json(serializeTimeEntry(entry, entryPresentation(req, res)));
  });
  api.patch('/workspaces/:wid/time_entries/:ids', async (req, res) => {
    // The id limit applies before any read.
    const ids = parseIdList(req.params.ids);
    const ws = await authorizedWorkspace(deps, req, res);
    const steps = parseEntryPatch(readJsonArray(req));
    res.json(await deps.entriesFor(res.locals.auth).patch(ws.id, ids, steps));
  });
  api.delete('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    await deps.entriesFor(res.locals.auth).remove(ws.id, parseId(req.params.id));
    res.status(200).end();
  });
  return api;
}
