import { isDeepStrictEqual } from 'node:util';
import { parseStorageConfig, type Backend, type StorageConfig } from '../packages/api/src/storage/config.ts';

export function browserBackend(env: Record<string, string | undefined>): Backend {
  const backend = env.TOKKL_E2E_BACKEND ?? 'sqlite';
  if (!['sqlite', 'postgres', 'mysql', 'mariadb'].includes(backend)) throw new Error('Unsupported browser test backend');
  if (backend !== 'sqlite' && env.TOKKL_DATABASE_URL !== undefined) {
    throw new Error('Disposable browser tests refuse an operator database target; unset TOKKL_DATABASE_URL');
  }
  return backend as Backend;
}

/** Only called with configuration returned by the disposable provisioner. Never logs credentials. */
export function disposableDatabaseUrl(config: StorageConfig): string {
  if (config.backend === 'sqlite') return `sqlite://${config.filename}`;
  const url = new URL(`${config.backend}://127.0.0.1`);
  url.hostname = config.host;
  url.port = String(config.port);
  url.username = config.user;
  url.password = config.password;
  url.pathname = `/${config.database}`;
  url.searchParams.set('sslmode', config.tls.mode);
  if (config.tls.mode === 'verify-full' && config.tls.caFile) url.searchParams.set('sslrootcert', config.tls.caFile);
  url.searchParams.set('pool_max', String(config.poolMax));
  url.searchParams.set('connect_timeout_ms', String(config.connectTimeoutMs));
  url.searchParams.set('query_timeout_ms', String(config.queryTimeoutMs));
  const value = url.href;
  if (!isDeepStrictEqual(parseStorageConfig({ TOKKL_DATABASE_URL: value }, '/tmp'), config)) {
    throw new Error('Disposable browser database configuration did not round trip');
  }
  return value;
}
