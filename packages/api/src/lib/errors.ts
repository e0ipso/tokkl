/**
 * Failures that domain and application code raise on purpose. Each carries a message that is safe
 * to show the client and a kind; `http/errors.ts` is the one place that turns a kind into a status.
 */
export type FailureKind = 'invalid' | 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'unavailable';

export class ApplicationError extends Error {
  readonly kind: FailureKind;
  /** Whole seconds the client should wait before trying again, for rate-limited or unavailable failures. */
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: FailureKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApplicationError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * A conflict that carries the current state the refused change was checked against, so the client
 * can catch up without another read. The state is the reply body in place of the message.
 */
export class StateConflict<T = unknown> extends ApplicationError {
  readonly state: T;

  constructor(message: string, state: T) {
    super('conflict', message);
    this.name = 'StateConflict';
    this.state = state;
  }
}

export const invalidInput = (message: string) => new ApplicationError('invalid', message);
export const forbidden = (message = 'Forbidden') => new ApplicationError('forbidden', message);
export const notFound = (message = 'Not found') => new ApplicationError('not-found', message);
export const conflict = (message: string) => new ApplicationError('conflict', message);
export const tooManyAttempts = (message: string, retryAfterSeconds: number) =>
  new ApplicationError('rate-limited', message, retryAfterSeconds);
/** The server is too busy for this request right now; the client may retry after the delay. */
export const unavailable = (message: string, retryAfterSeconds: number) =>
  new ApplicationError('unavailable', message, retryAfterSeconds);

/** Runs a calendar helper on client input, turning its RangeError into an invalid-input failure. */
export function calendarInput<T>(compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) throw invalidInput(error.message);
    throw error;
  }
}
