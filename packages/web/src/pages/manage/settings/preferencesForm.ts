import type { DurationFormat, PomodoroLimits, Preferences } from '@tokkl/types';
import { t, type MessageKey } from '../../../i18n/messages.ts';

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY'] as const;

export const TIME_FORMATS = [
  { value: 'H:mm', label: 'settings.time24', twelveHour: false },
  { value: 'h:mm A', label: 'settings.time12', twelveHour: true },
] as const satisfies ReadonlyArray<{ value: string; label: MessageKey; twelveHour: boolean }>;

export const DURATION_FORMATS: ReadonlyArray<{ value: DurationFormat; label: MessageKey }> = [
  { value: 'improved', label: 'settings.durationImproved' },
  { value: 'classic', label: 'settings.durationClassic' },
  { value: 'decimal', label: 'settings.durationDecimal' },
];

export const THEMES: ReadonlyArray<{ value: Preferences['theme']; label: MessageKey }> = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];

/** Labels and units are catalog keys; `limit` names the server's `pomodoro_limits` entry with the range and default. */
export const POMODORO_NUMBERS = [
  {
    key: 'pomodoro_focus_interval_in_minutes',
    label: 'pomodoro.lengthWork',
    shortUnit: 'pomodoro.unitMinutes',
    unit: 'pomodoro.spokenMinutes',
    limit: 'work_minutes',
  },
  {
    key: 'pomodoro_break_interval_in_minutes',
    label: 'pomodoro.lengthShortRest',
    shortUnit: 'pomodoro.unitMinutes',
    unit: 'pomodoro.spokenMinutes',
    limit: 'short_rest_minutes',
  },
  {
    key: 'pomodoro_long_break_interval_in_minutes',
    label: 'pomodoro.lengthLongRest',
    shortUnit: 'pomodoro.unitMinutes',
    unit: 'pomodoro.spokenMinutes',
    limit: 'long_rest_minutes',
  },
  {
    key: 'pomodoro_long_break_every',
    label: 'pomodoro.lengthLongRestEvery',
    shortUnit: 'pomodoro.unitPomodoros',
    unit: 'pomodoro.spokenPomodoros',
    limit: 'long_rest_every',
  },
] as const satisfies ReadonlyArray<{
  key: keyof Preferences;
  label: MessageKey;
  shortUnit: MessageKey;
  unit: MessageKey;
  limit: keyof PomodoroLimits;
}>;

const NUMBER_FIELDS = [
  ...POMODORO_NUMBERS,
  { key: 'long_timer_reminder_hours', unit: 'settings.spokenHours' },
] as const;
export type NumberKey = (typeof NUMBER_FIELDS)[number]['key'];

export type Editable = Pick<
  Preferences,
  | 'theme'
  | 'date_format'
  | 'timeofday_format'
  | 'duration_format'
  | 'collapseTimeEntries'
  | 'keyboard_shortcuts_enabled'
  | 'long_timer_reminder_enabled'
  | NumberKey
>;

/** Numbers are the input text, so a half-typed value survives. */
export type Draft = { [K in keyof Editable]: K extends NumberKey ? string : Editable[K] };

/** Defaults fill what an older account never saved; Pomodoro lengths default to the server's `limits`. */
export function editableOf(prefs: Preferences, limits: PomodoroLimits): Editable {
  return {
    theme: prefs.theme ?? 'system',
    long_timer_reminder_enabled: prefs.long_timer_reminder_enabled ?? true,
    long_timer_reminder_hours: prefs.long_timer_reminder_hours ?? 8,
    date_format: prefs.date_format,
    timeofday_format: prefs.timeofday_format,
    duration_format: prefs.duration_format,
    collapseTimeEntries: prefs.collapseTimeEntries,
    keyboard_shortcuts_enabled: prefs.keyboard_shortcuts_enabled,
    pomodoro_focus_interval_in_minutes: prefs.pomodoro_focus_interval_in_minutes ?? limits.work_minutes.default,
    pomodoro_break_interval_in_minutes: prefs.pomodoro_break_interval_in_minutes ?? limits.short_rest_minutes.default,
    pomodoro_long_break_interval_in_minutes:
      prefs.pomodoro_long_break_interval_in_minutes ?? limits.long_rest_minutes.default,
    pomodoro_long_break_every: prefs.pomodoro_long_break_every ?? limits.long_rest_every.default,
  };
}

export function toDraft(values: Editable): Draft {
  return {
    ...values,
    long_timer_reminder_hours: String(values.long_timer_reminder_hours),
    pomodoro_focus_interval_in_minutes: String(values.pomodoro_focus_interval_in_minutes),
    pomodoro_break_interval_in_minutes: String(values.pomodoro_break_interval_in_minutes),
    pomodoro_long_break_interval_in_minutes: String(values.pomodoro_long_break_interval_in_minutes),
    pomodoro_long_break_every: String(values.pomodoro_long_break_every),
  };
}

const isWholeNumber = (text: string) => text.trim() !== '' && Number.isInteger(Number(text.trim()));

/** A typed number compares by value, not text. */
export function isStored(key: keyof Draft, value: Draft[keyof Draft], stored: Editable): boolean {
  const current = stored[key];
  return typeof current === 'number'
    ? typeof value === 'string' && isWholeNumber(value) && Number(value.trim()) === current
    : value === current;
}

export function changesFrom(edits: Partial<Draft>): Partial<Preferences> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edits)) {
    changes[key] =
      typeof value === 'string' && NUMBER_FIELDS.some(field => field.key === key) ? Number(value.trim()) : value;
  }
  return changes;
}

export function numberErrors(draft: Draft): Array<readonly [NumberKey, string | false]> {
  return NUMBER_FIELDS.map(({ key, unit }) => [
    key,
    !isWholeNumber(draft[key]) && t('settings.wholeNumber', { unit: t(unit) }),
  ]);
}

export function refusedField(message: string): NumberKey | undefined {
  return NUMBER_FIELDS.find(({ key }) => message.startsWith(`Invalid ${key}:`))?.key;
}

/** A saved format this form does not offer stays selectable instead of silently switching. */
export function dateFormatOptions(current: string): string[] {
  return DATE_FORMATS.some(format => format === current) ? [...DATE_FORMATS] : [current, ...DATE_FORMATS];
}
