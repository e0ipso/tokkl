import type { PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { PomodoroLimits, Preferences } from '../../api/types.ts';
import type { MessageKey } from '../../i18n/messages.ts';
import { stepperStatus } from '../../components/lengthStepper.ts';

/**
 * The lengths the start form edits for one session, the preference each one starts from and its
 * limit in the server's `pomodoro_limits`. The label and units are catalog keys.
 */
export const LENGTH_FIELDS = [
  {
    key: 'workMinutes',
    limit: 'work_minutes',
    preference: 'pomodoro_focus_interval_in_minutes',
    label: 'pomodoro.lengthWork',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'shortRestMinutes',
    limit: 'short_rest_minutes',
    preference: 'pomodoro_break_interval_in_minutes',
    label: 'pomodoro.lengthShortRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestMinutes',
    limit: 'long_rest_minutes',
    preference: 'pomodoro_long_break_interval_in_minutes',
    label: 'pomodoro.lengthLongRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestEvery',
    limit: 'long_rest_every',
    preference: 'pomodoro_long_break_every',
    label: 'pomodoro.lengthLongRestEvery',
    unit: 'pomodoro.unitPomodoros',
    spokenUnit: 'pomodoro.spokenPomodoros',
  },
] as const satisfies ReadonlyArray<{
  key: keyof PomodoroSessionConfig;
  limit: keyof PomodoroLimits;
  preference: keyof Preferences;
  label: MessageKey;
  unit: MessageKey;
  spokenUnit: MessageKey;
}>;

export type LengthKey = (typeof LENGTH_FIELDS)[number]['key'];

/** The text typed into each length card, for the cards the user changed. */
export type LengthEdits = Partial<Record<LengthKey, string>>;

/** A card's text: what was typed, else the saved preference, else the server's default. */
export function lengthText(
  edits: LengthEdits,
  preferences: Preferences,
  limits: PomodoroLimits,
  field: (typeof LENGTH_FIELDS)[number],
): string {
  return edits[field.key] ?? String(preferences[field.preference] ?? limits[field.limit].default);
}

/** The session's lengths, or the first card whose text is not a length the server accepts. */
export function sessionConfig(
  edits: LengthEdits,
  preferences: Preferences,
  limits: PomodoroLimits,
): { config: PomodoroSessionConfig } | { invalid: LengthKey } {
  const config: PomodoroSessionConfig = {
    workMinutes: limits.work_minutes.default,
    shortRestMinutes: limits.short_rest_minutes.default,
    longRestMinutes: limits.long_rest_minutes.default,
    longRestEvery: limits.long_rest_every.default,
  };
  for (const field of LENGTH_FIELDS) {
    const text = lengthText(edits, preferences, limits, field);
    if (stepperStatus(text, limits[field.limit]) !== 'valid') return { invalid: field.key };
    config[field.key] = Number(text.trim());
  }
  return { config };
}
