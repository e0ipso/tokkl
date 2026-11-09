import type { DurationFormat, PomodoroLimits, Preferences } from '@tokkl/types';
import { t, type MessageKey } from '../../../i18n/messages.ts';

/** The preferences form's options, its draft shape and the rules that turn a draft into a save. */

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD.MM.YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
] as const;

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

/**
 * The lengths a new Pomodoro session starts with: the card's label, the short unit it shows, the unit
 * a screen reader and the error message name, and its limit in the server's `pomodoro_limits`, which
 * gives the range it accepts and the default. The texts are catalog keys.
 */
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

/** Every number the form edits, with the unit its error message names. */
export const NUMBER_FIELDS = [
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

/** What the form shows: the numbers are the text in their inputs, so a half-typed value survives. */
export type Draft = { [K in keyof Editable]: K extends NumberKey ? string : Editable[K] };

/**
 * The values the form edits, with defaults for the ones an older account has never saved; a
 * Pomodoro length's default is the server's (`limits`).
 */
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

export const isWholeNumber = (text: string) => text.trim() !== '' && Number.isInteger(Number(text.trim()));

/** Whether an edited value is what the server stores, comparing a typed number by its value, not its text. */
export function isStored(key: keyof Draft, value: Draft[keyof Draft], stored: Editable): boolean {
  const current = stored[key];
  return typeof current === 'number'
    ? typeof value === 'string' && isWholeNumber(value) && Number(value.trim()) === current
    : value === current;
}

/** The request body for the edited fields; a typed number goes as a number. */
export function changesFrom(edits: Partial<Draft>): Partial<Preferences> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edits)) {
    changes[key] =
      typeof value === 'string' && NUMBER_FIELDS.some(field => field.key === key) ? Number(value.trim()) : value;
  }
  return changes;
}

/** The error each number field shows before saving, or false when it holds a whole number. */
export function numberErrors(draft: Draft): Array<readonly [NumberKey, string | false]> {
  return NUMBER_FIELDS.map(({ key, unit }) => [
    key,
    !isWholeNumber(draft[key]) && t('settings.wholeNumber', { unit: t(unit) }),
  ]);
}

/** The number field a server refusal such as "Invalid pomodoro_long_break_every: ..." names, if any. */
export function refusedField(message: string): NumberKey | undefined {
  return NUMBER_FIELDS.find(({ key }) => message.startsWith(`Invalid ${key}:`))?.key;
}

/** The date formats to offer. A saved format this form doesn't offer stays selectable instead of silently switching. */
export function dateFormatOptions(current: string): string[] {
  return DATE_FORMATS.some(format => format === current) ? [...DATE_FORMATS] : [current, ...DATE_FORMATS];
}
