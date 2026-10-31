import { isDeepStrictEqual } from 'node:util';
import { parseStorageConfig, type Backend, type StorageConfig } from '../packages/api/src/storage/config.ts';

export function historyBackend(value: string | undefined, env: NodeJS.ProcessEnv): Backend {
  if (['TOKKL_DATABASE_URL', 'TIMETRACK_DATABASE_URL', 'DATABASE_URL'].some(key => env[key] !== undefined)) {
    throw new Error('Disposable history benchmarks refuse operator database targets; unset database URL settings');
  }
  const backend = value ?? 'sqlite';
  if (backend !== 'sqlite' && backend !== 'postgres' && backend !== 'mysql' && backend !== 'mariadb') {
    throw new Error('--backend must be sqlite, postgres, mysql or mariadb');
  }
  return backend;
}

/** Only accepts the owned provisioner's configuration; this secret value never enters evidence. */
export function databaseUrl(config: StorageConfig): string {
  let value: string;
  if (config.backend === 'sqlite') value = `sqlite://${config.filename}`;
  else {
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
    value = url.href;
  }
  if (!isDeepStrictEqual(parseStorageConfig({ TOKKL_DATABASE_URL: value }, '/tmp'), config)) {
    throw new Error('Disposable history database configuration did not round trip');
  }
  return value;
}

export function historyEnvironment(inherited: NodeJS.ProcessEnv, config: StorageConfig, directory: string, port: number, setupCode: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^(TOKKL|TIMETRACK)_/.test(key)));
  return { ...env, PORT: String(port), HOST: '127.0.0.1', TOKKL_DATA_DIR: directory, TOKKL_SETUP_CODE: setupCode, TOKKL_DATABASE_URL: databaseUrl(config) };
}
