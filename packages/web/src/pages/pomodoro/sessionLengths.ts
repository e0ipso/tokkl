import {
  DEFAULT_POMODORO_SESSION_CONFIG,
  POMODORO_SESSION_CONFIG_RANGES,
  type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { Preferences } from '../../api/types.ts';
import type { MessageKey } from '../../i18n/messages.ts';
import { stepperStatus } from '../../components/lengthStepper.ts';

/**
 * The lengths the start form edits for one session, and the preference each one starts from. The
 * label and units are catalog keys.
 */
export const LENGTH_FIELDS = [
  {
    key: 'workMinutes',
    preference: 'pomodoro_focus_interval_in_minutes',
    label: 'pomodoro.lengthWork',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'shortRestMinutes',
    preference: 'pomodoro_break_interval_in_minutes',
    label: 'pomodoro.lengthShortRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestMinutes',
    preference: 'pomodoro_long_break_interval_in_minutes',
    label: 'pomodoro.lengthLongRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestEvery',
    preference: 'pomodoro_long_break_every',
    label: 'pomodoro.lengthLongRestEvery',
    unit: 'pomodoro.unitPomodoros',
    spokenUnit: 'pomodoro.spokenPomodoros',
  },
] as const satisfies ReadonlyArray<{
  key: keyof PomodoroSessionConfig;
  preference: keyof Preferences;
  label: MessageKey;
  unit: MessageKey;
  spokenUnit: MessageKey;
}>;

export type LengthKey = (typeof LENGTH_FIELDS)[number]['key'];

/** The text typed into each length card, for the cards the user changed. */
export type LengthEdits = Partial<Record<LengthKey, string>>;

/** A card's text: what was typed, else the saved preference, else the default. */
export function lengthText(
  edits: LengthEdits,
  preferences: Preferences,
  field: (typeof LENGTH_FIELDS)[number],
): string {
  return edits[field.key] ?? String(preferences[field.preference] ?? DEFAULT_POMODORO_SESSION_CONFIG[field.key]);
}

/** The session's lengths, or the first card whose text is not a length the server accepts. */
export function sessionConfig(
  edits: LengthEdits,
  preferences: Preferences,
): { config: PomodoroSessionConfig } | { invalid: LengthKey } {
  const config = { ...DEFAULT_POMODORO_SESSION_CONFIG };
  for (const field of LENGTH_FIELDS) {
    const text = lengthText(edits, preferences, field);
    if (stepperStatus(text, POMODORO_SESSION_CONFIG_RANGES[field.key]) !== 'valid') return { invalid: field.key };
    config[field.key] = Number(text.trim());
  }
  return { config };
}
