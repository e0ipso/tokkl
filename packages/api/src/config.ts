import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  databasePath: string;
  webRoot: string;
  /** Trust X-Forwarded-For / X-Forwarded-Proto from a reverse proxy. */
  trustProxy: boolean;
  /**
   * Session lifetime used until an admin stores `session_days` in the instance settings. Read the
   * effective value through getInstanceSettings in models/settings.ts, never from here.
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

/** Default database file name. */
export const DATABASE_FILE = 'tokkl.sqlite';
/** Database file name used before the rename to Tokkl, kept when it is the only one present. */
export const LEGACY_DATABASE_FILE = 'timetrack.sqlite';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads the server settings from TOKKL_* variables. Each one falls back to the TIMETRACK_* name
 * it had before the rename, and a fallback adds a deprecation notice. With no database path set,
 * an existing timetrack.sqlite in the data directory is used when tokkl.sqlite does not exist yet;
 * the file is never moved or renamed.
 */
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
  const databasePath = setting('DATABASE');
  const config: Config = {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    databasePath: databasePath ?? join(dataDir, DATABASE_FILE),
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
  const legacyDatabase = join(dataDir, LEGACY_DATABASE_FILE);
  if (databasePath === undefined && !existsSync(config.databasePath) && existsSync(legacyDatabase)) {
    config.databasePath = legacyDatabase;
    notices.push(`Using the existing database ${legacyDatabase}. To switch to the new default name, stop the server and rename it, with any -wal and -shm files, to ${DATABASE_FILE}.`);
  }
  return { config, notices };
}
