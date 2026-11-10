import { ConfigurationError } from '../lib/configurationError.ts';
import { isAbsolute, join, resolve } from 'node:path';

export type Backend = 'sqlite' | 'postgres' | 'mysql' | 'mariadb';
export interface SqliteConfig {
  readonly backend: 'sqlite';
  readonly filename: string;
  readonly busyTimeoutMs: number;
}
export interface ServerConfig {
  readonly backend: 'postgres' | 'mysql' | 'mariadb';
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly poolMax: number;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly tls: { readonly mode: 'disable' } | { readonly mode: 'verify-full'; readonly caFile?: string };
}
/** Contains secrets; never log or return it over HTTP. */
export type StorageConfig = SqliteConfig | ServerConfig;

export class StorageConfigurationError extends ConfigurationError {
  constructor() {
    super('Invalid TOKKL_DATABASE_URL');
    this.name = 'StorageConfigurationError';
  }
}

const cleanText = (value: string) => value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
function bounded(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new StorageConfigurationError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new StorageConfigurationError();
  return number;
}

const SQLITE_BUSY_TIMEOUT_MS = 5000;
const SERVER_OPTIONS = new Set(['pool_max', 'connect_timeout_ms', 'query_timeout_ms', 'sslmode', 'sslrootcert']);

function sqliteFileConfig(raw: string): SqliteConfig {
  // Check the raw path before URL's dot-segment normalization can hide it.
  if (!raw.startsWith('sqlite:///') || /[?#]/.test(raw)) throw new StorageConfigurationError();
  const filename = decodeURIComponent(raw.slice('sqlite://'.length));
  if (
    !isAbsolute(filename) ||
    filename.startsWith('//') ||
    filename.endsWith('/') ||
    /[\x00-\x1f\x7f\\]/.test(filename) ||
    filename.split('/').some(part => part === '.' || part === '..')
  )
    throw new StorageConfigurationError();
  return { backend: 'sqlite', filename, busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS };
}

/** Each option at most once; full verification or no TLS, with an optional CA file. */
function serverTls(params: URLSearchParams): ServerConfig['tls'] {
  for (const key of params.keys()) {
    if (!SERVER_OPTIONS.has(key) || params.getAll(key).length !== 1) throw new StorageConfigurationError();
  }
  const mode = params.get('sslmode') ?? 'verify-full';
  if (mode !== 'verify-full' && mode !== 'disable') throw new StorageConfigurationError();
  const caFile = params.get('sslrootcert');
  if (caFile !== null && (mode !== 'verify-full' || !isAbsolute(caFile) || /[\x00-\x1f\x7f]/.test(caFile)))
    throw new StorageConfigurationError();
  return mode === 'disable' ? { mode } : { mode, ...(caFile === null ? {} : { caFile }) };
}

function serverConfig(raw: string): ServerConfig {
  const url = new URL(raw);
  const backend = url.protocol === 'postgresql:' ? 'postgres' : url.protocol.slice(0, -1);
  if (backend !== 'postgres' && backend !== 'mysql' && backend !== 'mariadb') throw new StorageConfigurationError();
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  // URL removes dot segments. Validate the requested path before that normalization.
  const rawPath = /^[a-z]+:\/\/[^/?#]*(\/[^?#]*)/i.exec(raw)?.[1] ?? '';
  const database = decodeURIComponent(rawPath.slice(1));
  if (
    !cleanText(user) ||
    /[\x00-\x1f\x7f]/.test(password) ||
    !cleanText(database) ||
    database === '.' ||
    database === '..' ||
    /[/\\]/.test(database) ||
    !url.hostname ||
    url.hash ||
    /[\\]/.test(raw)
  )
    throw new StorageConfigurationError();
  const tls = serverTls(url.searchParams);
  return {
    backend,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: bounded(url.port || null, backend === 'postgres' ? 5432 : 3306, 1, 65535),
    database,
    user,
    password,
    poolMax: bounded(url.searchParams.get('pool_max'), 5, 1, 20),
    connectTimeoutMs: bounded(url.searchParams.get('connect_timeout_ms'), 5000, 100, 60000),
    queryTimeoutMs: bounded(url.searchParams.get('query_timeout_ms'), 30000, 100, 300000),
    tls,
  };
}

/** Only an absent selector defaults. Unknown options and insecure TLS modes are errors. */
export function parseStorageConfig(env: { TOKKL_DATABASE_URL?: string }, dataDir: string): StorageConfig {
  const raw = env.TOKKL_DATABASE_URL;
  if (raw === undefined)
    return {
      backend: 'sqlite',
      filename: join(resolve(dataDir), 'tokkl.sqlite'),
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    };
  try {
    if (raw === 'sqlite::memory:')
      return { backend: 'sqlite', filename: ':memory:', busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS };
    if (!raw || /[\x00-\x20\x7f]/.test(raw)) throw new StorageConfigurationError();
    return raw.startsWith('sqlite:') ? sqliteFileConfig(raw) : serverConfig(raw);
  } catch {
    throw new StorageConfigurationError();
  }
}

/** Leaves out credentials, database, paths and query values. */
export function safeDestination(config: StorageConfig): string {
  if (config.backend === 'sqlite') return config.filename === ':memory:' ? 'sqlite:memory' : 'sqlite:file';
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  return `${config.backend}://${host}:${config.port}`;
}
