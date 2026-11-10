/** One JSON object per line. Never log credentials, bodies or headers, except the revisionless-action user agent. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function serializable(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(options: { level?: LogLevel } = {}, context: LogFields = {}): Logger {
  const { level = 'info' } = options;
  const write = (lineLevel: Exclude<LogLevel, 'silent'>, message: string, fields: LogFields = {}) => {
    if (RANK[lineLevel] < RANK[level]) return;
    const entry: Record<string, unknown> = { time: new Date().toISOString(), level: lineLevel, msg: message };
    for (const [key, value] of Object.entries({ ...context, ...fields })) entry[key] = serializable(value);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ time: entry.time, level: lineLevel, msg: message, fields: 'unserializable' });
    }
    if (lineLevel === 'warn' || lineLevel === 'error') console.error(line);
    else console.log(line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: fields => createLogger(options, { ...context, ...fields }),
  };
}

/** For composition roots that have no logger to hand. */
export const silentLogger: Logger = createLogger({ level: 'silent' });

/** The message may hold SQL, row values or connection details, so it is never kept. */
export interface ErrorDiagnostic {
  name: string;
  code?: string;
  frames: string[];
}

const MAX_FRAMES = 30;
const PLAIN_WORD = /^[A-Za-z0-9_.-]{1,40}$/;
const FRAME = /^\s+at \S/;

export function redactedDiagnostic(error: unknown): ErrorDiagnostic {
  if (!(error instanceof Error)) return { name: typeof error, frames: [] };
  const name = PLAIN_WORD.test(error.name) ? error.name : 'Error';
  const { code } = error as { code?: unknown };
  const stack = typeof error.stack === 'string' ? error.stack : '';
  // V8 starts the stack with the error's own text, which may span lines. The frames follow it.
  const head = String(error);
  const tail = stack.startsWith(head) ? stack.slice(head.length) : '';
  const frames = tail
    .split('\n')
    .filter(line => FRAME.test(line))
    .slice(0, MAX_FRAMES)
    .map(line => line.trim());
  return typeof code === 'string' && PLAIN_WORD.test(code) ? { name, code, frames } : { name, frames };
}
