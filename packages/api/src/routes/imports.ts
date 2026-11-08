import type { RequestHandler, Response, Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readText, textBody } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { noStore } from '../http/security.ts';
import { invalidInput } from '../lib/errors.ts';
import type { ImportPlace } from '../services/importAdmission.ts';

/** An import file may be much larger than any other request body. */
const IMPORT_LIMIT = '50mb';

/**
 * The account imports under `/api/app`. `createApp` mounts this router before the API's 1 MB body
 * parser: each route authenticates, CSRF check included, and takes an import place before it reads
 * its body, so only a signed-in user with a free place can make the server hold a large one. A
 * request that goes away cancels its import, which then rolls back whole.
 */
export function importRoutes(deps: Pick<Deps, 'auth' | 'importsFor' | 'importAdmission'>): Router {
  const api = createRouter();
  const places = new WeakMap<Response, ImportPlace>();
  /** Takes the place, or answers 503 with `Retry-After` before the body is read. */
  const admit: RequestHandler = (_req, res, next) => {
    const place = deps.importAdmission.admit(res.locals.auth.user.id);
    places.set(res, place);
    res.once('close', () => place.release());
    next();
  };
  /** Runs `work` in the request's place, which stays taken until the work settled. */
  const inPlace = <T>(res: Response, work: Promise<T>) => places.get(res)!.during(work);
  const signedInWithBody = [noStore, deps.auth.requireAuth, admit, textBody(IMPORT_LIMIT)];
  api.post('/import/toggl-csv', ...signedInWithBody, async (req, res) => {
    const text = readText(req);
    if (!text.trim()) throw invalidInput('The file is empty');
    // One `user=<key>` per selected Toggl user; keys may hold commas, so they are never joined.
    const users = queryList(req, 'user');
    if (users?.length === 0) throw invalidInput('Invalid user selection');
    const options = { dryRun: query(req, 'dry_run') === 'true', users, signal: res.locals.workSignal };
    return res.json(
      await inPlace(res, deps.importsFor(res.locals.auth).importTogglCsv(res.locals.auth.user.id, text, options)),
    );
  });
  api.post('/import/json', ...signedInWithBody, async (req, res) => {
    let data: unknown;
    try {
      data = JSON.parse(readText(req));
    } catch {
      throw invalidInput('The file is not valid JSON');
    }
    const options = { dryRun: query(req, 'dry_run') === 'true', signal: res.locals.workSignal };
    return res.json(
      await inPlace(res, deps.importsFor(res.locals.auth).importJsonExport(res.locals.auth.user.id, data, options)),
    );
  });
  return api;
}
