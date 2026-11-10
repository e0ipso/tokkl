import { isTimeResolution } from '@tokkl/common/snap';
import type { SettingsRepository } from './ports.ts';
import type { InstanceSettings } from './model.ts';

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
type NumericSetting = Exclude<keyof InstanceSettings, 'signupEnabled'>;
const SETTING_RULES: Readonly<Record<NumericSetting, SettingRule>> = {
  sessionDays: range(1, 365),
  inviteDays: range(1, 90),
  timeResolutionMinutes: { valid: isTimeResolution, expected: `one of ${TIME_RESOLUTIONS.join(', ')}` },
};
export const SETTING_NAMES = {
  session_days: 'sessionDays',
  invite_days: 'inviteDays',
  time_resolution_minutes: 'timeResolutionMinutes',
} as const satisfies Record<string, keyof InstanceSettings>;

export function validSetting(key: NumericSetting, value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && SETTING_RULES[key].valid(value);
}

/** For the 400 message. */
export const settingExpectation = (key: NumericSetting) => SETTING_RULES[key].expected;

export function timeResolutionOf(stored: Partial<InstanceSettings>): number {
  return validSetting('timeResolutionMinutes', stored.timeResolutionMinutes)
    ? stored.timeResolutionMinutes
    : DEFAULT_TIME_RESOLUTION;
}

/** Stored values that pass their rule, else the deployment's defaults. */
export async function getInstanceSettings(
  ctx: { settings: SettingsRepository },
  deploymentSessionDays: number,
): Promise<InstanceSettings> {
  const stored = await ctx.settings.read();
  return {
    sessionDays: validSetting('sessionDays', stored.sessionDays) ? stored.sessionDays : deploymentSessionDays,
    inviteDays: validSetting('inviteDays', stored.inviteDays) ? stored.inviteDays : DEFAULT_INVITE_DAYS,
    timeResolutionMinutes: timeResolutionOf(stored),
    signupEnabled: false,
  };
}
