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
  signup_enabled: 'signupEnabled',
} as const satisfies Record<string, keyof InstanceSettings>;

export function validSetting<K extends keyof InstanceSettings>(key: K, value: unknown): value is InstanceSettings[K] {
  if (key === 'signupEnabled') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isSafeInteger(value) && SETTING_RULES[key as NumericSetting].valid(value);
}

/** For the 400 message. */
export const settingExpectation = (key: keyof InstanceSettings) =>
  key === 'signupEnabled' ? 'true or false' : SETTING_RULES[key].expected;

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
    signupEnabled: validSetting('signupEnabled', stored.signupEnabled) ? stored.signupEnabled : false,
  };
}

/** Mail must still be available after an admin enabled sign-up. */
export function signupEffective(settings: Pick<InstanceSettings, 'signupEnabled'>, mailConfigured: boolean): boolean {
  return settings.signupEnabled && mailConfigured;
}
