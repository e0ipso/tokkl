import type { Request, RequestHandler, Response, Router } from 'express';
import type { Deps } from './context.ts';
import { errorReply } from '../http/errors.ts';
import { createRouter } from '../http/router.ts';
import { readText, refuseEncodedBody, textBody } from '../http/request.ts';
import { query, queryList } from '../http/params.ts';
import { noStore } from '../http/security.ts';
import { RequestCancelled, invalidInput, requestTimeout, tooLarge, tooManyAttempts } from '../lib/errors.ts';
import type { User } from '../domain/model.ts';
import type { ImportPlace } from '../services/importAdmission.ts';

/** An import file may be larger than any other request body: 8 MiB. */
const IMPORT_LIMIT_BYTES = 8 * 1024 * 1024;
/** From admission to the file's last byte. */
const IMPORT_UPLOAD_DEADLINE_MS = 60_000;
/** From the file's last byte to the reply. */
const IMPORT_PROCESSING_DEADLINE_MS = 5_000;

type ImportRouteDeps = Pick<Deps, 'auth' | 'importsFor' | 'importAdmission' | 'importLimiter'>;

interface ImportRouteOptions {
  /** One minute unless a test shortens it. */
  uploadDeadlineMs?: number;
  /** Five seconds unless a test shortens it. */
  processingDeadlineMs?: number;
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

/**
 * Aborts when the client leaves, the server stops, or `deadlineMs` after the whole file arrived, on the monotonic
 * clock; a deadline that already passed aborts at once. The import checks it between steps and answers 503 for the
 * deadline. It never interrupts a running query or rollback, which can outlast the deadline.
 */
function importSignal(res: Response, deadlineMs: number): AbortSignal {
  // `AbortSignal.timeout` takes whole milliseconds.
  const left = Math.ceil(deadlineMs - (performance.now() - res.locals.importBodyReceivedAt!));
  const deadline =
    left > 0
      ? AbortSignal.timeout(left)
      : AbortSignal.abort(new DOMException('Import deadline passed', 'TimeoutError'));
  return AbortSignal.any([res.locals.workSignal, deadline]);
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
function startCsvImport(deps: ImportRouteDeps, req: Request, res: Response, deadlineMs: number) {
  const signal = importSignal(res, deadlineMs);
  const text = takeText(req);
  if (!text.trim()) throw invalidInput('The file is empty');
  // One `user=<key>` per selected Toggl user; keys may hold commas, so they are never joined.
  const users = queryList(req, 'user');
  if (users?.length === 0) throw invalidInput('Invalid user selection');
  const options = { dryRun: query(req, 'dry_run') === 'true', users, signal };
  return deps.importsFor(res.locals.auth).importTogglCsv(text, options);
}
function startJsonImport(deps: ImportRouteDeps, req: Request, res: Response, deadlineMs: number) {
  // Built after the synchronous parse, so a parse that took the whole deadline already aborted it.
  const data = parseImportFile(takeText(req));
  const options = { dryRun: query(req, 'dry_run') === 'true', signal: importSignal(res, deadlineMs) };
  return deps.importsFor(res.locals.auth).importJsonExport(data, options);
}

/** SQLite can give a deleted account's id to the next one; the creation instant keeps their counters apart. */
function importStartKey({ id, createdAt }: User): string {
  return JSON.stringify([id, createdAt]);
}

/**
 * Counts the start whatever happens next, a busy refusal included, so the check always fails. The reservation is
 * released before this returns, so none stays open while the body is read or the import runs.
 */
function chargeStart(deps: Pick<ImportRouteDeps, 'importLimiter'>): RequestHandler {
  return async (_req, res, next) => {
    const start = await deps.importLimiter.attempt(importStartKey(res.locals.auth.user), async () => false);
    next(start.refused ? tooManyAttempts('Too many imports; try again later', start.retryAfter) : undefined);
  };
}

/**
 * Mounted before the 1 MB parser: routes authenticate, refuse an encoded or oversized body, charge the account's
 * import starts, and take an import place before reading the body.
 */
export function importRoutes(deps: ImportRouteDeps, options: ImportRouteOptions = {}): Router {
  const api = createRouter();
  const places = new WeakMap<Response, ImportPlace>();
  const placeOf = (res: Response) => places.get(res)!;
  /** Answers 503 with `Retry-After` before the body is read. */
  const admit: RequestHandler = (req, res, next) => {
    // The client can leave while its start is charged; a response that already closed would never give a place back.
    if (res.locals.workSignal.aborted) return next(new RequestCancelled('Import cancelled'));
    const place = deps.importAdmission.admit(res.locals.auth.user.id, reservedBytes(req));
    places.set(res, place);
    res.once('close', () => place.release());
    next();
  };
  /** The place stays taken until the work settled, a rollback after the deadline included. */
  const inPlace = <T>(res: Response, work: Promise<T>) => placeOf(res).during(work);
  const processingDeadlineMs = options.processingDeadlineMs ?? IMPORT_PROCESSING_DEADLINE_MS;
  const receive = receiveWithin(options.uploadDeadlineMs ?? IMPORT_UPLOAD_DEADLINE_MS, placeOf);
  const signedInWithBody = [
    noStore,
    deps.auth.requireAuth,
    refuseEncodedBody,
    refuseOversizedDeclaration,
    chargeStart(deps),
    admit,
    receive,
  ];
  api.post('/import/toggl-csv', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startCsvImport(deps, req, res, processingDeadlineMs)));
  });
  api.post('/import/json', ...signedInWithBody, async (req, res) => {
    res.json(await inPlace(res, startJsonImport(deps, req, res, processingDeadlineMs)));
  });
  return api;
}
