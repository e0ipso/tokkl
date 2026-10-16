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

export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** A 429 that tells the client how many whole seconds to wait. */
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new HttpError(429, message, { 'Retry-After': String(retryAfterSeconds) });
