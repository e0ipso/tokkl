import {
  DEFAULT_POMODORO_SESSION_CONFIG,
  POMODORO_SESSION_CONFIG_RANGES,
  type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { Preferences } from '../../api/types.ts';
import { stepperStatus } from '../../components/lengthStepper.ts';

/** The lengths the start form edits for one session, and the preference each one starts from. */
export const LENGTH_FIELDS = [
  {
    key: 'workMinutes',
    preference: 'pomodoro_focus_interval_in_minutes',
    label: 'Work',
    unit: 'min',
    spokenUnit: 'minutes',
  },
  {
    key: 'shortRestMinutes',
    preference: 'pomodoro_break_interval_in_minutes',
    label: 'Short rest',
    unit: 'min',
    spokenUnit: 'minutes',
  },
  {
    key: 'longRestMinutes',
    preference: 'pomodoro_long_break_interval_in_minutes',
    label: 'Long rest',
    unit: 'min',
    spokenUnit: 'minutes',
  },
  {
    key: 'longRestEvery',
    preference: 'pomodoro_long_break_every',
    label: 'Long rest every',
    unit: 'pomodoros',
    spokenUnit: 'pomodoros',
  },
] as const satisfies ReadonlyArray<{
  key: keyof PomodoroSessionConfig;
  preference: keyof Preferences;
  label: string;
  unit: string;
  spokenUnit: string;
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
