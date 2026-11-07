import type { ErrorRequestHandler, Response } from 'express';
import { ApplicationError, RequestCancelled, StateConflict, type FailureKind } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';

const STATUS: Readonly<Record<FailureKind, number>> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'rate-limited': 429,
  unavailable: 503,
};

/** What the client receives for a failure: a status, extra headers and a JSON body. */
export interface ErrorReply {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

/** The reply for an application failure. A refused state change answers with the current state. */
function applicationErrorReply(error: ApplicationError): ErrorReply {
  const headers: Record<string, string> =
    error.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(error.retryAfterSeconds) };
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
export function errorReply(error: unknown): ErrorReply {
  if (error instanceof ApplicationError) return applicationErrorReply(error);
  return frameworkErrorReply(error) ?? { status: 500, headers: {}, body: 'Internal Server Error' };
}

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
    const reply = errorReply(error);
    if (!(error instanceof ApplicationError) && reply.status >= 500) log.error('Request failed', { error });
    else if (reply.status >= 500) log.warn('Request refused', { status: reply.status, reason: reply.body });
    res.status(reply.status).set(reply.headers).json(reply.body);
  };
}
