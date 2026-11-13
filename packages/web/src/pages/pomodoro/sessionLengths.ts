import type { PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { PomodoroLimits, Preferences } from '@tokkl/types';
import { POMODORO_FIELDS } from '../../components/pomodoroFields.ts';
import { stepperStatus } from '../../components/lengthStepper.ts';

export type LengthKey = (typeof POMODORO_FIELDS)[number]['key'];

export type LengthEdits = Partial<Record<LengthKey, string>>;

/** What was typed, else the saved preference, else the server's default. */
export function lengthText(
  edits: LengthEdits,
  preferences: Preferences,
  limits: PomodoroLimits,
  field: (typeof POMODORO_FIELDS)[number],
): string {
  return edits[field.key] ?? String(preferences[field.preference] ?? limits[field.limit].default);
}

/** Or the first card whose text the server would not accept. */
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
  for (const field of POMODORO_FIELDS) {
    const text = lengthText(edits, preferences, limits, field);
    if (stepperStatus(text, limits[field.limit]) !== 'valid') return { invalid: field.key };
    config[field.key] = Number(text.trim());
  }
  return { config };
}
