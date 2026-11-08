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

/**
 * The file size an import is admitted with: its declared length, or the body limit when it sends
 * none, as a chunked upload does. A body that does not match its length is refused by the parser.
 */
function declaredBytes(req: Request): number {
  const length = Number(req.headers['content-length']);
  return Number.isSafeInteger(length) && length >= 0 ? Math.min(length, IMPORT_LIMIT_BYTES) : IMPORT_LIMIT_BYTES;
}

/** The request body as text, taken out of the request so the request no longer holds it. */
function takeText(req: Request): string {
  const text = readText(req);
  req.body = undefined;
  return text;
}

/** Parses a JSON import file; the text is dropped once this returns. */
function parseImportFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalidInput('The file is not valid JSON');
  }
}

/*
 * The handlers start an import in a plain function and await only its promise, so neither the
 * request nor a suspended handler keeps the file's text while the import's transaction runs.
 */
function startCsvImport(deps: ImportRouteDeps, req: Request, res: Response) {
  const text = takeText(req);
  if (!text.trim()) throw invalidInput('The file is empty');
  // One `user=<key>` per selected Toggl user; keys may hold commas, so they are never joined.
  const users = queryList(req, 'user');
  if (users?.length === 0) throw invalidInput('Invalid user selection');
  const options = { dryRun: query(req, 'dry_run') === 'true', users, signal: res.locals.workSignal };
  return deps.importsFor(res.locals.auth).importTogglCsv(res.locals.auth.user.id, text, options);
}
function startJsonImport(deps: ImportRouteDeps, req: Request, res: Response) {
  const data = parseImportFile(takeText(req));
  const options = { dryRun: query(req, 'dry_run') === 'true', signal: res.locals.workSignal };
  return deps.importsFor(res.locals.auth).importJsonExport(res.locals.auth.user.id, data, options);
}

/**
 * The account imports under `/api/app`. `createApp` mounts this router before the API's 1 MB body
 * parser: each route authenticates, CSRF check included, and takes an import place sized by the
 * file's declared length before it reads its body, so only a signed-in user with a free place can
 * make the server hold a large one. A request that goes away cancels its import, which then rolls
 * back whole.
 */
export function importRoutes(deps: ImportRouteDeps): Router {
  const api = createRouter();
  const places = new WeakMap<Response, ImportPlace>();
  /** Takes the place, or answers 503 with `Retry-After` before the body is read. */
  const admit: RequestHandler = (req, res, next) => {
    const place = deps.importAdmission.admit(res.locals.auth.user.id, declaredBytes(req));
    places.set(res, place);
    res.once('close', () => place.release());
    next();
  };
  /** Runs `work` in the request's place, which stays taken until the work settled. */
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
