import type { Request, RequestHandler, Response, Router } from 'express';
import type { Deps } from './context.ts';
import { errorReply } from '../http/errors.ts';
import { createRouter } from '../http/router.ts';
import { readText, refuseEncodedBody, textBody } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { noStore } from '../http/security.ts';
import { invalidInput, requestTimeout, tooLarge } from '../lib/errors.ts';
import type { ImportPlace } from '../services/importAdmission.ts';

/** An import file may be larger than any other request body: 8 MiB. */
const IMPORT_LIMIT_BYTES = 8 * 1024 * 1024;
/** From admission to the file's last byte. */
const IMPORT_UPLOAD_DEADLINE_MS = 60_000;

type ImportRouteDeps = Pick<Deps, 'auth' | 'importsFor' | 'importAdmission'>;

interface ImportRouteOptions {
  /** One minute unless a test shortens it. */
  uploadDeadlineMs?: number;
}

/** None for a chunked body or a header that is not a plain number. */
function declaredLength(req: Request): number | undefined {
  const header = req.headers['content-length'];
  return header !== undefined && /^\d+$/.test(header) ? Number(header) : undefined;
}

/** A 413 before any byte is read or any place is taken. */
const refuseOversizedDeclaration: RequestHandler = (req, _res, next) => {
  const declared = declaredLength(req);
  next(declared !== undefined && declared > IMPORT_LIMIT_BYTES ? tooLarge('Request body too large') : undefined);
};

/** The declared length, or the whole limit for a body that declares none; the parser refuses a body that differs. */
function reservedBytes(req: Request): number {
  return declaredLength(req) ?? IMPORT_LIMIT_BYTES;
}

/** Written at once, so it reaches the socket before the request is destroyed. */
function refuseLateUpload(req: Request, res: Response) {
  if (!res.headersSent) {
    const reply = errorReply(requestTimeout('The upload took too long'));
    res.status(reply.status).set(reply.headers).json(reply.body);
  }
  req.destroy();
}

/**
 * Parses the file within `deadlineMs` of admission; more bytes do not extend it. A late upload gets a 408 and its
 * request is destroyed. The place stays held until the parser stopped, so no body still arrives beside a new import.
 */
function receiveWithin(deadlineMs: number, place: (res: Response) => ImportPlace): RequestHandler {
  const parse = textBody(IMPORT_LIMIT_BYTES);
  return (req, res, next) => {
    let parserStopped!: () => void;
    void place(res).during(new Promise<void>(resolve => (parserStopped = resolve)));
    req.once('close', () => parserStopped());
    let late = false;
    const deadline = setTimeout(() => {
      late = true;
      refuseLateUpload(req, res);
    }, deadlineMs);
    res.once('close', () => clearTimeout(deadline));
    parse(req, res, error => {
      clearTimeout(deadline);
      parserStopped();
      if (late) return;
      if (!error) res.locals.importBodyReceivedAt = performance.now();
      next(error);
    });
  };
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

/**
 * Mounted before the 1 MB parser: routes authenticate, refuse an encoded or oversized body, and take an import
 * place before reading the body.
 */
export function importRoutes(deps: ImportRouteDeps, options: ImportRouteOptions = {}): Router {
  const api = createRouter();
  const places = new WeakMap<Response, ImportPlace>();
  const placeOf = (res: Response) => places.get(res)!;
  /** Answers 503 with `Retry-After` before the body is read. */
  const admit: RequestHandler = (req, res, next) => {
    const place = deps.importAdmission.admit(res.locals.auth.user.id, reservedBytes(req));
    places.set(res, place);
    res.once('close', () => place.release());
    next();
  };
  /** The place stays taken until the work settled. */
  const inPlace = <T>(res: Response, work: Promise<T>) => placeOf(res).during(work);
  const receive = receiveWithin(options.uploadDeadlineMs ?? IMPORT_UPLOAD_DEADLINE_MS, placeOf);
  const signedInWithBody = [
    noStore,
    deps.auth.requireAuth,
    refuseEncodedBody,
    refuseOversizedDeclaration,
    admit,
    receive,
  ];
  api.post('/import/toggl-csv', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startCsvImport(deps, req, res)));
  });
  api.post('/import/json', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startJsonImport(deps, req, res)));
  });
  return api;
}
