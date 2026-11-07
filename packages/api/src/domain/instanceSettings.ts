import { isTimeResolution } from '@tokkl/common/snap';
import type { SettingsRepository } from '../storage/contracts.ts';
import type { InstanceSettings } from '../storage/domain.ts';
import { invalidInput } from '../lib/errors.ts';

/** Every time resolution an admin can choose: the divisors of 60. */
export const TIME_RESOLUTIONS = Array.from({ length: 60 }, (_, i) => i + 1).filter(isTimeResolution);
export const DEFAULT_TIME_RESOLUTION = 5;
const DEFAULT_INVITE_DAYS = 7;

interface SettingRule {
  valid(value: number): boolean;
  expected: string;
}
const range = (min: number, max: number): SettingRule => ({
  valid: value => value >= min && value <= max,
  expected: `an integer from ${min} to ${max}`,
});
const SETTING_RULES: Readonly<Record<keyof InstanceSettings, SettingRule>> = {
  sessionDays: range(1, 365),
  inviteDays: range(1, 90),
  timeResolutionMinutes: { valid: isTimeResolution, expected: `one of ${TIME_RESOLUTIONS.join(', ')}` },
};
/** Request field names of the settings. */
const SETTING_NAMES = {
  session_days: 'sessionDays',
  invite_days: 'inviteDays',
  time_resolution_minutes: 'timeResolutionMinutes',
} as const satisfies Record<string, keyof InstanceSettings>;

function validSetting(key: keyof InstanceSettings, value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && SETTING_RULES[key].valid(value);
}

/** The settings a PUT changes. Unknown keys and values outside a rule are a 400 naming the field. */
export function readSettingChanges(body: Record<string, unknown>): Partial<InstanceSettings> {
  const changes: Partial<InstanceSettings> = {};
  for (const [name, value] of Object.entries(body)) {
    if (!Object.hasOwn(SETTING_NAMES, name)) throw invalidInput(`Unknown setting: ${name}`);
    const key = SETTING_NAMES[name as keyof typeof SETTING_NAMES];
    if (!validSetting(key, value)) throw invalidInput(`Invalid ${name}: expected ${SETTING_RULES[key].expected}`);
    changes[key] = value;
  }
  if (!Object.keys(changes).length)
    throw invalidInput('Expected session_days or invite_days or time_resolution_minutes');
  return changes;
}

/** The stored time resolution when it is valid, else the default. */
export function timeResolutionOf(stored: Partial<InstanceSettings>): number {
  return validSetting('timeResolutionMinutes', stored.timeResolutionMinutes)
    ? stored.timeResolutionMinutes
    : DEFAULT_TIME_RESOLUTION;
}

/** The effective settings: stored values that pass their rule, else the deployment's defaults. */
export async function getInstanceSettings(
  ctx: { settings: SettingsRepository },
  deploymentSessionDays: number,
): Promise<InstanceSettings> {
  const stored = await ctx.settings.read();
  return {
    sessionDays: validSetting('sessionDays', stored.sessionDays) ? stored.sessionDays : deploymentSessionDays,
    inviteDays: validSetting('inviteDays', stored.inviteDays) ? stored.inviteDays : DEFAULT_INVITE_DAYS,
    timeResolutionMinutes: timeResolutionOf(stored),
  };
}
