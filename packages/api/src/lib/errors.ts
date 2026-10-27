export class HttpError extends Error {
  readonly status: number;
  /** Response headers the error handler sets, such as Retry-After. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, message: string, headers: Readonly<Record<string, string>> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/**
 * A 409 that carries a JSON body to reply with in place of the message, such as the current state
 * a refused change was checked against, so the client can catch up without another read.
 */
export class ConflictWithBody<T = unknown> extends HttpError {
  readonly body: T;

  constructor(message: string, body: T) {
    super(409, message);
    this.body = body;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** A 429 that tells the client how many whole seconds to wait. */
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new HttpError(429, message, { 'Retry-After': String(retryAfterSeconds) });
