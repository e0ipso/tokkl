import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  databasePath: string;
  webRoot: string;
  /** Trust X-Forwarded-For / X-Forwarded-Proto from a reverse proxy. */
  trustProxy: boolean;
  sessionDays: number;
  /** Optional fixed setup code; a random one is generated and logged otherwise. */
  setupCode: string | undefined;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.TIMETRACK_DATA_DIR ?? 'data');
  return {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    databasePath: env.TIMETRACK_DATABASE ?? join(dataDir, 'timetrack.sqlite'),
    webRoot: resolve(env.TIMETRACK_WEB_ROOT ?? 'dist/web'),
    trustProxy: bool(env.TIMETRACK_TRUST_PROXY, false),
    sessionDays: int(env.TIMETRACK_SESSION_DAYS, 30),
    setupCode: env.TIMETRACK_SETUP_CODE || undefined,
  };
}
