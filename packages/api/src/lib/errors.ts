/**
 * Failures that domain and application code raise on purpose. Each carries a message that is safe
 * to show the client and a kind; `http/errors.ts` is the one place that turns a kind into a status.
 */
export type FailureKind = 'invalid' | 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'unavailable';

/**
 * Why input was refused, for clients that act on it. Codes and field names are stable; the human
 * message may change wording at any time.
 */
export type ValidationCode =
  /** Any refused input without a more specific code. */
  | 'invalid_input'
  /** A known preference with a value the apps cannot use; `field` is the preference key. */
  | 'invalid_preference'
  /** An instance setting outside its rule; `field` is the setting name. */
  | 'invalid_setting'
  /** A setting name the instance does not have. */
  | 'unknown_setting';
export interface ValidationDetail {
  code: ValidationCode;
  /** The request field the refusal names. Always a name the server defines, never client text. */
  field?: string;
}

export class ApplicationError extends Error {
  readonly kind: FailureKind;
  /** Whole seconds the client should wait before trying again, for rate-limited or unavailable failures. */
  readonly retryAfterSeconds: number | undefined;
  /** Set on every invalid-input failure. */
  readonly validation: ValidationDetail | undefined;

  constructor(kind: FailureKind, message: string, retryAfterSeconds?: number, validation?: ValidationDetail) {
    super(message);
    this.name = 'ApplicationError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.validation = validation;
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

/**
 * Work stopped because the request that asked for it ended: the client went away, or the server
 * is shutting down. It is not a server fault; `http/errors.ts` answers only a client still there.
 */
export class RequestCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCancelled';
  }
}

export const invalidInput = (message: string, validation: ValidationDetail = { code: 'invalid_input' }) =>
  new ApplicationError('invalid', message, undefined, validation);
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
