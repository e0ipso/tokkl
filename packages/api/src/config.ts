import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { parseStorageConfig, type StorageConfig } from './storage/config.ts';
import { isLogLevel, LOG_LEVELS, type LogLevel } from './lib/logger.ts';
import { ConfigurationError } from './lib/configurationError.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  tls: 'starttls' | 'tls' | 'none';
}

export interface MailConfiguration {
  configured: boolean;
  missing: string[];
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  storage: StorageConfig;
  webRoot: string;
  /** `false` for none, a hop count, or proxy IPs and CIDR ranges. Passed to Express's `trust proxy` as is. */
  trustProxy: false | number | readonly string[];
  /** Used until an admin stores `session_days`. */
  sessionDays: number;
  /** A random one is generated and logged otherwise. */
  setupCode: string | undefined;
  /** Defaults to info. */
  logLevel: LogLevel;
  publicUrl: string | undefined;
  smtp: SmtpConfig | undefined;
  mail: MailConfiguration;
}

interface LoadedConfig {
  config: Config;
  /** Deprecated settings or files still in use. */
  notices: string[];
}

/** Its presence requires an explicit database selection. */
const LEGACY_DATABASE_FILE = 'timetrack.sqlite';

export { ConfigurationError };

/** Keep partial sender configuration visible even when there is no SMTP host. */
export function mailConfigured(env: NodeJS.ProcessEnv): MailConfiguration {
  const missing = ['TOKKL_SMTP_HOST', 'TOKKL_SMTP_FROM', 'TOKKL_PUBLIC_URL'].filter(name => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
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

/** Unset or blank means `fallback`; anything else outside the range is refused. */
function integerSetting(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return fallback;
  const parsed = /^[0-9]+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new ConfigurationError(`Invalid ${name}: expected a whole number from ${min} to ${max}.`);
  return parsed;
}

function hostSetting(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return '0.0.0.0';
  if (/[\s\x00-\x1f\x7f]/.test(trimmed))
    throw new ConfigurationError('Invalid HOST: expected an address or host name.');
  return trimmed;
}

function publicUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (/^https?:\/\/[^/?#\\\s]+\/?$/i.test(trimmed) && !url.username && !url.password) return url.origin;
  } catch {
    // URL errors include the input, so replace them with a configuration-only diagnostic.
  }
  throw new ConfigurationError(
    'Invalid TOKKL_PUBLIC_URL: use an absolute http or https origin with no credentials, path, query or fragment.',
  );
}

function smtpConfig(env: NodeJS.ProcessEnv): SmtpConfig | undefined {
  const host = env.TOKKL_SMTP_HOST?.trim();
  if (!host) return undefined;
  const tls = env.TOKKL_SMTP_TLS?.trim() || 'starttls';
  if (tls !== 'starttls' && tls !== 'tls' && tls !== 'none')
    throw new ConfigurationError('Invalid TOKKL_SMTP_TLS: use starttls, tls or none.');
  const smtp: SmtpConfig = {
    host,
    from: env.TOKKL_SMTP_FROM?.trim() ?? '',
    port: integerSetting('TOKKL_SMTP_PORT', env.TOKKL_SMTP_PORT, 587, 1, 65535),
    tls,
  };
  // Transport code can read credentials, but JSON and ordinary diagnostic inspection omit them.
  Object.defineProperties(smtp, {
    user: { value: env.TOKKL_SMTP_USER || undefined },
    password: { value: env.TOKKL_SMTP_PASSWORD || undefined },
  });
  return smtp;
}

/** Old data needs an explicit storage selection. */
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
    throw new ConfigurationError(
      'Existing database configuration requires an explicit TOKKL_DATABASE_URL; unsupported schemas must be exported before switching.',
    );
  }
  const config: Config = {
    port: integerSetting('PORT', env.PORT, 8080, 0, 65535),
    host: hostSetting(env.HOST),
    dataDir,
    storage: parseStorageConfig(env, dataDir),
    webRoot: resolve(setting('WEB_ROOT') ?? 'dist/web'),
    trustProxy: trustProxy(setting('TRUST_PROXY')),
    // The same range an admin can store as session_days.
    sessionDays: integerSetting('TOKKL_SESSION_DAYS', setting('SESSION_DAYS'), 30, 1, 365),
    setupCode: setting('SETUP_CODE') || undefined,
    logLevel: logLevel(env.TOKKL_LOG_LEVEL),
    publicUrl: publicUrl(env.TOKKL_PUBLIC_URL),
    smtp: smtpConfig(env),
    mail: mailConfigured(env),
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
