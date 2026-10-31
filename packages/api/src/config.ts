import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseStorageConfig, type StorageConfig } from './storage/config.ts';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  storage: StorageConfig;
  webRoot: string;
  /** Trust X-Forwarded-For / X-Forwarded-Proto from a reverse proxy. */
  trustProxy: boolean;
  /**
   * Session lifetime used until an admin stores `session_days` in the instance settings. Read the
   * effective value through the account domain settings operation.
   */
  sessionDays: number;
  /** Optional fixed setup code; a random one is generated and logged otherwise. */
  setupCode: string | undefined;
}

export interface LoadedConfig {
  config: Config;
  /** Lines to log at startup about deprecated settings or files still in use. */
  notices: string[];
}

/** Its presence requires explicit database selection before startup. */
export const LEGACY_DATABASE_FILE = 'timetrack.sqlite';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
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
  if (env.TOKKL_DATABASE_URL === undefined && (env.TOKKL_DATABASE !== undefined || env.TIMETRACK_DATABASE !== undefined || existsSync(join(dataDir, LEGACY_DATABASE_FILE)))) {
    throw new Error('Existing database configuration requires an explicit TOKKL_DATABASE_URL; unsupported schemas must be exported before switching.');
  }
  const config: Config = {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    storage: parseStorageConfig(env, dataDir),
    webRoot: resolve(setting('WEB_ROOT') ?? 'dist/web'),
    trustProxy: bool(setting('TRUST_PROXY'), false),
    sessionDays: int(setting('SESSION_DAYS'), 30),
    setupCode: setting('SETUP_CODE') || undefined,
  };

  const notices: string[] = [];
  if (legacyNames.length > 0) {
    const renamed = legacyNames.map((name) => name.replace(/^TIMETRACK_/, 'TOKKL_'));
    notices.push(`Deprecated: ${legacyNames.join(', ')} still work, but a later release may drop them; rename them to ${renamed.join(', ')}.`);
  }
  return { config, notices };
}
