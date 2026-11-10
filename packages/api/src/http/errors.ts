import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ApplicationError, RequestCancelled, StateConflict, type FailureKind } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';

declare module 'express-serve-static-core' {
  interface Locals {
    /** Set under `/api/app`: refused input there names its code and field in headers. */
    validationHeaders?: boolean;
  }
}

const ERROR_CODE_HEADER = 'Tokkl-Error-Code';
const ERROR_FIELD_HEADER = 'Tokkl-Error-Field';

const STATUS: Readonly<Record<FailureKind, number>> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  unprocessable: 422,
  'rate-limited': 429,
  unavailable: 503,
};

interface ErrorReply {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

interface ErrorReplyOptions {
  validationHeaders?: boolean;
}

function applicationErrorReply(error: ApplicationError, options: ErrorReplyOptions): ErrorReply {
  const headers: Record<string, string> =
    error.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(error.retryAfterSeconds) };
  if (options.validationHeaders && error.validation) {
    headers[ERROR_CODE_HEADER] = error.validation.code;
    if (error.validation.field !== undefined) headers[ERROR_FIELD_HEADER] = error.validation.field;
  }
  return {
    status: STATUS[error.kind],
    headers,
    body: error instanceof StateConflict ? error.state : error.message,
  };
}

/** Body-parser and Express failures carry a `type` or a 4xx `status`; anything else is unexpected. */
function frameworkErrorReply(error: unknown): ErrorReply | undefined {
  const { type, status, message } = (error ?? {}) as { type?: unknown; status?: unknown; message?: unknown };
  if (type === 'entity.too.large') return { status: 413, headers: {}, body: 'Request body too large' };
  if (typeof type === 'string' && (type.startsWith('entity.') || type.startsWith('request.')))
    return { status: 400, headers: {}, body: 'Invalid request body' };
  // http-errors from Express itself, such as a missing file under /assets.
  if (typeof status === 'number' && status >= 400 && status < 500)
    return { status, headers: {}, body: typeof message === 'string' ? message : 'Request failed' };
  return undefined;
}

/** Unexpected errors become a 500 that reveals nothing. */
export function errorReply(error: unknown, options: ErrorReplyOptions = {}): ErrorReply {
  if (error instanceof ApplicationError) return applicationErrorReply(error, options);
  return frameworkErrorReply(error) ?? { status: 500, headers: {}, body: 'Internal Server Error' };
}

/** The Toggl-compatible API never sends them, so its refusals match what Toggl clients expect. */
export const validationHeaders: RequestHandler = (_req, res, next) => {
  res.locals.validationHeaders = true;
  next();
};

const disconnected = (res: Response) => res.destroyed || !res.socket || res.socket.destroyed;

/** Unexpected errors are logged with their stack, server side only; cancelled work is logged at debug. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    const log = (res.locals.log as Logger | undefined) ?? logger;
    if (error instanceof RequestCancelled && disconnected(res)) {
      log.debug('Request cancelled', { reason: error.message });
      return;
    }
    if (res.headersSent) return next(error);
    const reply = errorReply(error, { validationHeaders: res.locals.validationHeaders === true });
    if (!(error instanceof ApplicationError) && reply.status >= 500) log.error('Request failed', { error });
    else if (reply.status >= 500) log.warn('Request refused', { status: reply.status, reason: reply.body });
    res.status(reply.status).set(reply.headers).json(reply.body);
  };
}
