/** Each carries a message safe to show the client; `http/errors.ts` alone maps a kind to a status. */
export type FailureKind =
  | 'invalid'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'unsupported-media'
  | 'unprocessable'
  | 'rate-limited'
  | 'unavailable';

/** Codes and field names are stable; the human message may change wording at any time. */
type ValidationCode =
  | 'invalid_input'
  /** `field` is the preference key. */
  | 'invalid_preference'
  /** `field` is the setting name. */
  | 'invalid_setting'
  | 'unknown_setting'
  /** An import file passes a record, size or nesting limit. */
  | 'import_limit';
export interface ValidationDetail {
  code: ValidationCode;
  /** Always a name the server defines, never client text. */
  field?: string;
}

export class ApplicationError extends Error {
  readonly kind: FailureKind;
  /** For rate-limited or unavailable failures. */
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

/** The current state replaces the message as the reply body, so the client can catch up without a read. */
export class StateConflict<T = unknown> extends ApplicationError {
  readonly state: T;

  constructor(message: string, state: T) {
    super('conflict', message);
    this.name = 'StateConflict';
    this.state = state;
  }
}

/** The client went away or the server is shutting down. Not a server fault; only a client still there gets a reply. */
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
/** The body comes in a form the server refuses to read, such as a compressed encoding. */
export const unsupportedMedia = (message: string) => new ApplicationError('unsupported-media', message);
/** Well formed, but contradicts a request the server already handled. */
export const unprocessable = (message: string) => new ApplicationError('unprocessable', message);
export const tooManyAttempts = (message: string, retryAfterSeconds: number) =>
  new ApplicationError('rate-limited', message, retryAfterSeconds);
export const unavailable = (message: string, retryAfterSeconds: number) =>
  new ApplicationError('unavailable', message, retryAfterSeconds);

/** Turns a calendar helper's RangeError on client input into an invalid-input failure. */
export function calendarInput<T>(compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) throw invalidInput(error.message);
    throw error;
  }
}
