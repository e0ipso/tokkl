import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ApplicationError, RequestCancelled, StateConflict, type FailureKind } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';

declare module 'express-serve-static-core' {
  interface Locals {
    /** Set under `/api/app`: refused input there names its code and field in headers. */
    validationHeaders?: boolean;
  }
}

/** The response headers that carry a refusal's `ValidationDetail`. */
export const ERROR_CODE_HEADER = 'Tokkl-Error-Code';
export const ERROR_FIELD_HEADER = 'Tokkl-Error-Field';

const STATUS: Readonly<Record<FailureKind, number>> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  unprocessable: 422,
  'rate-limited': 429,
  unavailable: 503,
};

/** What the client receives for a failure: a status, extra headers and a JSON body. */
export interface ErrorReply {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface ErrorReplyOptions {
  /** Adds the validation code and field headers. The body stays the same either way. */
  validationHeaders?: boolean;
}

/** The reply for an application failure. A refused state change answers with the current state. */
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

/** The client's reply for any thrown value. Unexpected errors become a 500 that reveals nothing. */
export function errorReply(error: unknown, options: ErrorReplyOptions = {}): ErrorReply {
  if (error instanceof ApplicationError) return applicationErrorReply(error, options);
  return frameworkErrorReply(error) ?? { status: 500, headers: {}, body: 'Internal Server Error' };
}

/**
 * Mounted on `/api/app`, the web app's own API: its refusals carry the validation headers. The
 * Toggl-compatible API answers exactly as before.
 */
export const validationHeaders: RequestHandler = (_req, res, next) => {
  res.locals.validationHeaders = true;
  next();
};

/** True once the client's connection is gone, so nothing written would reach it. */
const disconnected = (res: Response) => res.destroyed || !res.socket || res.socket.destroyed;

/**
 * The last middleware. Unexpected errors are logged with their stack on the server only. Work
 * cancelled because its client went away is expected: it is logged at debug and nothing is sent.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    // The request's logger carries its id, so the line can be matched to the access log.
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
