import type { Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readText, textBody } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { noStore } from '../http/security.ts';
import { invalidInput } from '../lib/errors.ts';

/** An import file may be much larger than any other request body. */
const IMPORT_LIMIT = '50mb';

/**
 * The account imports under `/api/app`. `createApp` mounts this router before the API's 1 MB body
 * parser: each route authenticates, CSRF check included, before it reads its body, so only a
 * signed-in user can make the server hold a large one.
 */
export function importRoutes(deps: Pick<Deps, 'auth' | 'importsFor'>): Router {
  const api = createRouter();
  const signedInWithBody = [noStore, deps.auth.requireAuth, textBody(IMPORT_LIMIT)];
  api.post('/import/toggl-csv', ...signedInWithBody, async (req, res) => {
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
  api.post('/import/json', ...signedInWithBody, async (req, res) => {
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
  return api;
}
