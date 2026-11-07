import { isTimeResolution } from '@tokkl/common/snap';
import type { SettingsRepository } from '../storage/contracts.ts';
import type { InstanceSettings } from '../storage/domain.ts';

/** Every time resolution an admin can choose: the divisors of 60. */
const TIME_RESOLUTIONS = Array.from({ length: 60 }, (_, i) => i + 1).filter(isTimeResolution);
const DEFAULT_TIME_RESOLUTION = 5;
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
export const SETTING_NAMES = {
  session_days: 'sessionDays',
  invite_days: 'inviteDays',
  time_resolution_minutes: 'timeResolutionMinutes',
} as const satisfies Record<string, keyof InstanceSettings>;

export function validSetting(key: keyof InstanceSettings, value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && SETTING_RULES[key].valid(value);
}

/** What a valid value of `key` looks like, for the 400 message. */
export const settingExpectation = (key: keyof InstanceSettings) => SETTING_RULES[key].expected;

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
