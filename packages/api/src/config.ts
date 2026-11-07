import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { parseStorageConfig, type StorageConfig } from './storage/config.ts';
import { isLogLevel, LOG_LEVELS, type LogLevel } from './lib/logger.ts';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  storage: StorageConfig;
  webRoot: string;
  /**
   * Which reverse proxies may set X-Forwarded-For / X-Forwarded-Proto: `false` for none, a hop
   * count, or proxy IP addresses and CIDR ranges. Passed to Express's `trust proxy` setting as is.
   */
  trustProxy: false | number | readonly string[];
  /**
   * Session lifetime used until an admin stores `session_days` in the instance settings. Read the
   * effective value through the account domain settings operation.
   */
  sessionDays: number;
  /** Optional fixed setup code; a random one is generated and logged otherwise. */
  setupCode: string | undefined;
  /** The least severe log level written, from TOKKL_LOG_LEVEL. Defaults to info. */
  logLevel: LogLevel;
}

export interface LoadedConfig {
  config: Config;
  /** Lines to log at startup about deprecated settings or files still in use. */
  notices: string[];
}

/** Its presence requires explicit database selection before startup. */
export const LEGACY_DATABASE_FILE = 'timetrack.sqlite';

/** An invalid setting. Its message names the setting and holds no secret, so startup prints it. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function isAddressOrRange(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

const invalidTrustProxy = () =>
  new ConfigurationError(
    'Invalid TOKKL_TRUST_PROXY: use empty or 0 to trust no proxy, a positive number of proxy hops, or a comma-separated list of IP addresses and CIDR ranges.',
  );

function trustProxy(value: string | undefined): Config['trustProxy'] {
  const trimmed = (value ?? '').trim();
  if (/^[0-9]*$/.test(trimmed)) {
    const hops = Number(trimmed);
    // A count too large to be exact, such as Infinity, would trust every hop.
    if (!Number.isSafeInteger(hops)) throw invalidTrustProxy();
    return hops > 0 ? hops : false;
  }
  const entries = trimmed.split(',').map(entry => entry.trim());
  if (entries.every(isAddressOrRange)) return entries;
  throw invalidTrustProxy();
}

function logLevel(value: string | undefined): LogLevel {
  const level = (value ?? '').trim().toLowerCase() || 'info';
  if (isLogLevel(level)) return level;
  throw new ConfigurationError(`Invalid TOKKL_LOG_LEVEL: use one of ${LOG_LEVELS.join(', ')}.`);
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads validated storage selection and unrelated deployment settings. Old data needs explicit selection. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const legacyNames: string[] = [];
  const setting = (name: string): string | undefined => {
    const value = env[`TOKKL_${name}`];
    if (value !== undefined) return value;
    const legacy = env[`TIMETRACK_${name}`];
    if (legacy !== undefined) legacyNames.push(`TIMETRACK_${name}`);
    return legacy;
  };

  const dataDir = resolve(setting('DATA_DIR') ?? 'data');
  if (
    env.TOKKL_DATABASE_URL === undefined &&
    (env.TOKKL_DATABASE !== undefined ||
      env.TIMETRACK_DATABASE !== undefined ||
      existsSync(join(dataDir, LEGACY_DATABASE_FILE)))
  ) {
    throw new Error(
      'Existing database configuration requires an explicit TOKKL_DATABASE_URL; unsupported schemas must be exported before switching.',
    );
  }
  const config: Config = {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    storage: parseStorageConfig(env, dataDir),
    webRoot: resolve(setting('WEB_ROOT') ?? 'dist/web'),
    trustProxy: trustProxy(setting('TRUST_PROXY')),
    sessionDays: int(setting('SESSION_DAYS'), 30),
    setupCode: setting('SETUP_CODE') || undefined,
    logLevel: logLevel(env.TOKKL_LOG_LEVEL),
  };

  const notices: string[] = [];
  if (legacyNames.length > 0) {
    const renamed = legacyNames.map(name => name.replace(/^TIMETRACK_/, 'TOKKL_'));
    notices.push(
      `Deprecated: ${legacyNames.join(', ')} still work, but a later release may drop them; rename them to ${renamed.join(', ')}.`,
    );
  }
  return { config, notices };
}
