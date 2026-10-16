import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';

/**
 * Settings an admin changes at runtime, stored in instance_settings. Everything else in Config
 * (port, host, paths, trust proxy, setup code) stays env-only and never appears here.
 */
export interface InstanceSettings {
  /** Lifetime of a new login session. Existing sessions keep the expiry they were created with. */
  session_days: number;
  /** Lifetime of a new invite link. */
  invite_days: number;
}

export type SettingKey = keyof InstanceSettings;

interface SettingRule {
  min: number;
  max: number;
  fallback: (config: Config) => number;
}

const SETTING_RULES: Record<SettingKey, SettingRule> = {
  // TOKKL_SESSION_DAYS, which loadConfig already defaults to 30.
  session_days: { min: 1, max: 365, fallback: (config) => config.sessionDays },
  invite_days: { min: 1, max: 90, fallback: () => 7 },
};

const SETTING_KEYS = Object.keys(SETTING_RULES) as SettingKey[];

const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTING_RULES, key);

const isValid = (key: SettingKey, value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= SETTING_RULES[key].min && (value as number) <= SETTING_RULES[key].max;

function storedValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The value in effect for every setting: the stored one, or its default when none is stored or it is unusable. */
export function getInstanceSettings(db: Db, config: Config): InstanceSettings {
  const rows = db.prepare('SELECT key, value FROM instance_settings').all() as Array<{ key: string; value: string }>;
  const stored = new Map(rows.map((row) => [row.key, storedValue(row.value)]));
  const settings = {} as InstanceSettings;
  for (const key of SETTING_KEYS) {
    const value = stored.get(key);
    settings[key] = isValid(key, value) ? value : SETTING_RULES[key].fallback(config);
  }
  return settings;
}

/** Validates a settings update. Unknown keys, non-integers and out-of-range values are a 400. */
export function readSettingChanges(body: Record<string, unknown>): Partial<InstanceSettings> {
  const changes: Partial<InstanceSettings> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isSettingKey(key)) throw badRequest(`Unknown setting: ${key}`);
    const { min, max } = SETTING_RULES[key];
    if (!isValid(key, value)) throw badRequest(`Invalid ${key}: expected an integer from ${min} to ${max}`);
    changes[key] = value;
  }
  if (Object.keys(changes).length === 0) throw badRequest(`Expected ${SETTING_KEYS.join(' or ')}`);
  return changes;
}

export function updateInstanceSettings(db: Db, changes: Partial<InstanceSettings>, userId: number): void {
  transaction(db, () => {
    const now = nowIso();
    const upsert = db.prepare(`
      INSERT INTO instance_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
                                      updated_by = excluded.updated_by
    `);
    for (const [key, value] of Object.entries(changes)) upsert.run(key, JSON.stringify(value), now, userId);
  });
}
