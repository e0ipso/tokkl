import {
  DEFAULT_POMODORO_SESSION_CONFIG,
  POMODORO_SESSION_CONFIG_RANGES,
  type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { JsonObject, User } from './model.ts';
import { MAX_NAME_LENGTH } from './catalogCommands.ts';
import { MAX_DESCRIPTION_LENGTH } from './entryCommands.ts';
export const MAX_ACCOUNT_TEXT_LENGTH = 255;
export const MIN_PASSWORD_LENGTH = 8;
/** Existing longer passwords still verify. */
export const MAX_PASSWORD_LENGTH = 1024;

/** A check for typos, not deliverability. */
export const isEmailAddress = (value: string) => /^[^@\s]+@[^@\s]+$/.test(value);

/** Folds only ASCII A-Z, like users.email_key on every engine; toLowerCase would also fold Ä. */
export function normalizeEmail(email: string): string {
  return email.trim().replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Unknown keys sent by clients are kept as-is. */
export const DEFAULT_PREFERENCES = {
  date_format: 'YYYY-MM-DD',
  timeofday_format: 'H:mm',
  duration_format: 'improved',
  collapseTimeEntries: true,
  manualMode: false,
  pg_time_zone_name: 'UTC',
  record_timeline: false,
  send_product_emails: false,
  send_timer_notifications: false,
  send_weekly_report: false,
  idle_detection_enabled: false,
  pomodoro_focus_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.workMinutes,
  pomodoro_break_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.shortRestMinutes,
  pomodoro_long_break_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.longRestMinutes,
  pomodoro_long_break_every: DEFAULT_POMODORO_SESSION_CONFIG.longRestEvery,
  reminder_enabled: false,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
  keyboard_shortcuts_enabled: true,
  theme: 'system',
} as const;

export type Preferences = JsonObject;

export const MAX_FAVORITES = 9;

interface PreferenceRule {
  valid: (value: unknown) => boolean;
  expected: string;
}

const boolean: PreferenceRule = { valid: value => typeof value === 'boolean', expected: 'a boolean' };
// Formats are free text so clients can save custom patterns.
const format: PreferenceRule = {
  valid: value => typeof value === 'string' && value.trim() !== '' && value.length <= 255,
  expected: 'a non-empty string of at most 255 characters',
};
const oneOf = (...values: string[]): PreferenceRule => ({
  valid: value => typeof value === 'string' && values.includes(value),
  expected: `one of ${values.join(', ')}`,
});
/** Fractions, numeric strings, null and booleans fail. */
const integerFrom = (min: number, max: number): PreferenceRule => ({
  valid: value => Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  expected: `an integer from ${min} to ${max}`,
});

const pomodoroRange = (key: keyof PomodoroSessionConfig): PreferenceRule => {
  const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
  return integerFrom(min, max);
};

const isOptionalId = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) > 0);

function isFavorite(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const favorite = value as Record<string, unknown>;
  return (
    typeof favorite.description === 'string' &&
    favorite.description.length <= MAX_DESCRIPTION_LENGTH &&
    isOptionalId(favorite.project_id) &&
    isOptionalId(favorite.task_id) &&
    Array.isArray(favorite.tags) &&
    favorite.tags.every(tag => typeof tag === 'string' && tag.length <= MAX_NAME_LENGTH) &&
    typeof favorite.billable === 'boolean'
  );
}

/** Other keys are stored as sent. A Map, so a key such as `constructor` finds no inherited rule. */
const PREFERENCE_RULES = new Map<string, PreferenceRule>(
  Object.entries({
    date_format: format,
    timeofday_format: format,
    duration_format: oneOf('improved', 'classic', 'decimal'),
    theme: oneOf('system', 'light', 'dark'),
    timerView: oneOf('list', 'calendar'),
    collapseTimeEntries: boolean,
    manualMode: boolean,
    keyboard_shortcuts_enabled: boolean,
    showTimeInTitle: boolean,
    pomodoro_focus_interval_in_minutes: pomodoroRange('workMinutes'),
    pomodoro_break_interval_in_minutes: pomodoroRange('shortRestMinutes'),
    pomodoro_long_break_interval_in_minutes: pomodoroRange('longRestMinutes'),
    pomodoro_long_break_every: pomodoroRange('longRestEvery'),
    long_timer_reminder_enabled: boolean,
    long_timer_reminder_hours: integerFrom(1, 168),
    favorites: {
      valid: value => Array.isArray(value) && value.length <= MAX_FAVORITES && value.every(isFavorite),
      expected: `a list of at most ${MAX_FAVORITES} favorites with description, project_id, task_id, tags and billable`,
    },
  } satisfies Record<string, PreferenceRule>),
);

const isUsable = (key: string, value: unknown) => PREFERENCE_RULES.get(key)?.valid(value) ?? true;

/** The 400 message, or undefined when the value is usable. */
export function preferenceProblem(key: string, value: unknown): string | undefined {
  const rule = PREFERENCE_RULES.get(key);
  return !rule || rule.valid(value) ? undefined : `Invalid ${key}: expected ${rule.expected}`;
}

export function getPreferences(user: User): Preferences {
  // Values saved before validation existed fall back to the defaults instead of reaching clients.
  const stored = Object.entries(user.preferences).filter(([key, value]) => isUsable(key, value));
  return { ...DEFAULT_PREFERENCES, ...Object.fromEntries(stored) };
}

export function getPomodoroSessionConfig(user: User): PomodoroSessionConfig {
  const preferences = getPreferences(user);
  return {
    workMinutes: preferences.pomodoro_focus_interval_in_minutes as number,
    shortRestMinutes: preferences.pomodoro_break_interval_in_minutes as number,
    longRestMinutes: preferences.pomodoro_long_break_interval_in_minutes as number,
    longRestEvery: preferences.pomodoro_long_break_every as number,
  };
}
