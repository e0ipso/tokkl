export interface SafeHistoryError {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
  cause?: SafeHistoryError;
}

/** Only diagnostic fields are retained; stacks, request bodies and credentials are excluded. */
export function safeHistoryError(error: unknown, depth = 0): SafeHistoryError {
  const source = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  const redact = (text: string) => text.replace(/[a-z][a-z\d+.-]*:\/\/[^\s'"<>]+/gi, '[redacted-url]')
    .replace(/\b(?:password|passwd|authorization|cookie|api[_-]?token|setup[_-]?code)\s*[:=]\s*[^\r\n,;]+/gi, '[redacted-credential]').slice(0, 500);
  return {
    name: typeof source.name === 'string' ? redact(source.name) : 'Error',
    message: typeof source.message === 'string' ? redact(source.message) : 'Benchmark operation failed',
    ...(typeof source.code === 'string' || typeof source.code === 'number' ? { code: typeof source.code === 'string' ? redact(source.code) : source.code } : {}),
    ...(typeof source.status === 'number' && Number.isInteger(source.status) ? { status: source.status } : {}),
    ...(source.cause !== undefined && depth < 3 ? { cause: safeHistoryError(source.cause, depth + 1) } : {}),
  };
}

export class HistoryFailure extends Error {
  readonly operation?: SafeHistoryError;
  readonly cleanup: { status: 'succeeded' | 'failed'; error?: SafeHistoryError };
  api_cleanup?: unknown;

  constructor(operation: SafeHistoryError | undefined, cleanup: HistoryFailure['cleanup']) {
    super(operation?.message ?? cleanup.error?.message ?? 'Benchmark failed');
    this.name = 'HistoryFailure';
    this.operation = operation;
    this.cleanup = cleanup;
  }
}

export function historyFailure(error: unknown) {
  return error instanceof HistoryFailure
    ? { operation: error.operation, cleanup: error.cleanup, api_cleanup: error.api_cleanup }
    : { operation: safeHistoryError(error), cleanup: { status: 'not_started' as const } };
}

/** Await owned cleanup and retain its outcome alongside the primary operation error. */
export async function withHistoryCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let value!: T;
  let primary: { error: unknown } | undefined;
  try { value = await operation(); }
  catch (error) { primary = { error }; }
  let cleaned: HistoryFailure['cleanup'] = { status: 'succeeded' };
  try { await cleanup(); }
  catch (error) { cleaned = { status: 'failed', error: safeHistoryError(error) }; }
  if (primary || cleaned.status === 'failed') throw new HistoryFailure(primary ? safeHistoryError(primary.error) : undefined, cleaned);
  return value;
}
