/**
 * Structured logs: one JSON object per line, `debug` and `info` on stdout, `warn` and `error` on
 * stderr. Callers pass a fixed message and context fields; they never pass credentials, request
 * bodies or headers. An Error in a field is written as its name, message and stack.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line, such as a request id. */
  child(fields: LogFields): Logger;
}

export type LogSink = (line: string, level: Exclude<LogLevel, 'silent'>) => void;

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
  now?: () => Date;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const standardStreams: LogSink = (line, level) => {
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function serializable(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(options: LoggerOptions = {}, context: LogFields = {}): Logger {
  const { level = 'info', sink = standardStreams, now = () => new Date() } = options;
  const write = (lineLevel: Exclude<LogLevel, 'silent'>, message: string, fields: LogFields = {}) => {
    if (RANK[lineLevel] < RANK[level]) return;
    const entry: Record<string, unknown> = { time: now().toISOString(), level: lineLevel, msg: message };
    for (const [key, value] of Object.entries({ ...context, ...fields })) entry[key] = serializable(value);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ time: entry.time, level: lineLevel, msg: message, fields: 'unserializable' });
    }
    sink(line, lineLevel);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: fields => createLogger(options, { ...context, ...fields }),
  };
}

/** Discards everything. For composition roots that have no logger to hand. */
export const silentLogger: Logger = createLogger({ level: 'silent' });
