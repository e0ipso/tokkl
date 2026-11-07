import { DEFAULT_POMODORO_SESSION_CONFIG, POMODORO_SESSION_CONFIG_RANGES } from '@tokkl/common/pomodoroSession';
import type { DurationFormat, Preferences } from '../../../api/types.ts';
import type { StepperRange } from '../../../components/lengthStepper.ts';

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
  { value: 'H:mm', label: '24-hour', twelveHour: false },
  { value: 'h:mm A', label: '12-hour', twelveHour: true },
] as const;

export const DURATION_FORMATS: ReadonlyArray<{ value: DurationFormat; label: string }> = [
  { value: 'improved', label: 'Improved' },
  { value: 'classic', label: 'Classic' },
  { value: 'decimal', label: 'Decimal' },
];

export const THEMES: ReadonlyArray<{ value: Preferences['theme']; label: string }> = [
  { value: 'system', label: 'Match the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The lengths a new Pomodoro session starts with: the card's label, the short unit it shows, the unit
 * a screen reader and the error message name, and the range the server accepts.
 */
export const POMODORO_NUMBERS = [
  {
    key: 'pomodoro_focus_interval_in_minutes',
    label: 'Work',
    shortUnit: 'min',
    unit: 'minutes',
    range: POMODORO_SESSION_CONFIG_RANGES.workMinutes,
  },
  {
    key: 'pomodoro_break_interval_in_minutes',
    label: 'Short rest',
    shortUnit: 'min',
    unit: 'minutes',
    range: POMODORO_SESSION_CONFIG_RANGES.shortRestMinutes,
  },
  {
    key: 'pomodoro_long_break_interval_in_minutes',
    label: 'Long rest',
    shortUnit: 'min',
    unit: 'minutes',
    range: POMODORO_SESSION_CONFIG_RANGES.longRestMinutes,
  },
  {
    key: 'pomodoro_long_break_every',
    label: 'Long rest every',
    shortUnit: 'pomodoros',
    unit: 'pomodoros',
    range: POMODORO_SESSION_CONFIG_RANGES.longRestEvery,
  },
] as const satisfies ReadonlyArray<{
  key: keyof Preferences;
  label: string;
  shortUnit: string;
  unit: string;
  range: StepperRange;
}>;

/** Every number the form edits, with the unit its error message names. */
export const NUMBER_FIELDS = [...POMODORO_NUMBERS, { key: 'long_timer_reminder_hours', unit: 'hours' }] as const;
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

/** The values the form edits, with defaults for the ones an older account has never saved. */
export function editableOf(prefs: Preferences): Editable {
  return {
    theme: prefs.theme ?? 'system',
    long_timer_reminder_enabled: prefs.long_timer_reminder_enabled ?? true,
    long_timer_reminder_hours: prefs.long_timer_reminder_hours ?? 8,
    date_format: prefs.date_format,
    timeofday_format: prefs.timeofday_format,
    duration_format: prefs.duration_format,
    collapseTimeEntries: prefs.collapseTimeEntries,
    keyboard_shortcuts_enabled: prefs.keyboard_shortcuts_enabled,
    pomodoro_focus_interval_in_minutes:
      prefs.pomodoro_focus_interval_in_minutes ?? DEFAULT_POMODORO_SESSION_CONFIG.workMinutes,
    pomodoro_break_interval_in_minutes:
      prefs.pomodoro_break_interval_in_minutes ?? DEFAULT_POMODORO_SESSION_CONFIG.shortRestMinutes,
    pomodoro_long_break_interval_in_minutes:
      prefs.pomodoro_long_break_interval_in_minutes ?? DEFAULT_POMODORO_SESSION_CONFIG.longRestMinutes,
    pomodoro_long_break_every: prefs.pomodoro_long_break_every ?? DEFAULT_POMODORO_SESSION_CONFIG.longRestEvery,
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
  return NUMBER_FIELDS.map(({ key, unit }) => [key, !isWholeNumber(draft[key]) && `Enter a whole number of ${unit}`]);
}

/** The number field a server refusal such as "Invalid pomodoro_long_break_every: ..." names, if any. */
export function refusedField(message: string): NumberKey | undefined {
  return NUMBER_FIELDS.find(({ key }) => message.startsWith(`Invalid ${key}:`))?.key;
}

/** The date formats to offer. A saved format this form doesn't offer stays selectable instead of silently switching. */
export function dateFormatOptions(current: string): string[] {
  return DATE_FORMATS.some(format => format === current) ? [...DATE_FORMATS] : [current, ...DATE_FORMATS];
}
