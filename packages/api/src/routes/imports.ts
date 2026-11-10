import type { Request, RequestHandler, Response, Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readText, textBody } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { noStore } from '../http/security.ts';
import { invalidInput } from '../lib/errors.ts';
import type { ImportPlace } from '../services/importAdmission.ts';

/** An import file may be much larger than any other request body: 50 MB. */
const IMPORT_LIMIT_BYTES = 50 * 1024 * 1024;

type ImportRouteDeps = Pick<Deps, 'auth' | 'importsFor' | 'importAdmission'>;

/** Its declared length, or the body limit for a chunked upload; the parser refuses a mismatched body. */
function declaredBytes(req: Request): number {
  const length = Number(req.headers['content-length']);
  return Number.isSafeInteger(length) && length >= 0 ? Math.min(length, IMPORT_LIMIT_BYTES) : IMPORT_LIMIT_BYTES;
}

/** So the request no longer holds it. */
function takeText(req: Request): string {
  const text = readText(req);
  req.body = undefined;
  return text;
}

/** The text is dropped once this returns. */
function parseImportFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalidInput('The file is not valid JSON');
  }
}

/* Started in a plain function so no request or suspended handler keeps the file's text during the import. */
function startCsvImport(deps: ImportRouteDeps, req: Request, res: Response) {
  const text = takeText(req);
  if (!text.trim()) throw invalidInput('The file is empty');
  // One `user=<key>` per selected Toggl user; keys may hold commas, so they are never joined.
  const users = queryList(req, 'user');
  if (users?.length === 0) throw invalidInput('Invalid user selection');
  const options = { dryRun: query(req, 'dry_run') === 'true', users, signal: res.locals.workSignal };
  return deps.importsFor(res.locals.auth).importTogglCsv(text, options);
}
function startJsonImport(deps: ImportRouteDeps, req: Request, res: Response) {
  const data = parseImportFile(takeText(req));
  const options = { dryRun: query(req, 'dry_run') === 'true', signal: res.locals.workSignal };
  return deps.importsFor(res.locals.auth).importJsonExport(data, options);
}

/** Mounted before the 1 MB parser: routes authenticate and take an import place before reading the body. */
export function importRoutes(deps: ImportRouteDeps): Router {
  const api = createRouter();
  const places = new WeakMap<Response, ImportPlace>();
  /** Answers 503 with `Retry-After` before the body is read. */
  const admit: RequestHandler = (req, res, next) => {
    const place = deps.importAdmission.admit(res.locals.auth.user.id, declaredBytes(req));
    places.set(res, place);
    res.once('close', () => place.release());
    next();
  };
  /** The place stays taken until the work settled. */
  const inPlace = <T>(res: Response, work: Promise<T>) => places.get(res)!.during(work);
  const signedInWithBody = [noStore, deps.auth.requireAuth, admit, textBody(IMPORT_LIMIT_BYTES)];
  api.post('/import/toggl-csv', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startCsvImport(deps, req, res)));
  });
  api.post('/import/json', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startJsonImport(deps, req, res)));
  });
  return api;
}
