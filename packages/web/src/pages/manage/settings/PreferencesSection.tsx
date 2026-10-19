import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useSavePreferences } from '../../../api/hooks.ts';
import type { DurationFormat, Preferences } from '../../../api/types.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { formatDate, formatTime, today, useSettings } from '../../../lib/settings.ts';
import { formatDuration } from '@tokkl/common/duration';
import { DEFAULT_POMODORO_SETTINGS } from '@tokkl/common/pomodoro';
import { SettingsCard } from './SettingsCard.tsx';

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY'] as const;

const TIME_FORMATS = [
  { value: 'H:mm', label: '24-hour', twelveHour: false },
  { value: 'h:mm A', label: '12-hour', twelveHour: true },
] as const;

const DURATION_FORMATS: ReadonlyArray<{ value: DurationFormat; label: string }> = [
  { value: 'improved', label: 'Improved' },
  { value: 'classic', label: 'Classic' },
  { value: 'decimal', label: 'Decimal' },
];

const THEMES: ReadonlyArray<{ value: Preferences['theme']; label: string }> = [
  { value: 'system', label: 'Match the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** 47 minutes and 6 seconds, the example Toggl uses for its duration formats. */
const SAMPLE_SECONDS = 47 * 60 + 6;

/** The Pomodoro fields that hold a whole number, with the unit the error message names. */
const POMODORO_NUMBERS = [
  { key: 'pomodoro_focus_interval_in_minutes', label: 'Work phase (minutes)', unit: 'minutes' },
  { key: 'pomodoro_break_interval_in_minutes', label: 'Short break (minutes)', unit: 'minutes' },
  { key: 'pomodoro_long_break_interval_in_minutes', label: 'Long break (minutes)', unit: 'minutes' },
  { key: 'pomodoro_long_break_every', label: 'Long break every (work phases)', unit: 'work phases' },
] as const satisfies ReadonlyArray<{ key: keyof Preferences; label: string; unit: string }>;

type PomodoroNumberKey = typeof POMODORO_NUMBERS[number]['key'];

type Editable = Pick<Preferences,
  'theme' | 'date_format' | 'timeofday_format' | 'duration_format' | 'collapseTimeEntries' | 'keyboard_shortcuts_enabled'
  | 'pomodoro_enabled' | 'pomodoro_stop_timer_at_end' | PomodoroNumberKey>;

/** What the form shows: the Pomodoro numbers are the text in their inputs, so a half-typed value survives. */
type Draft = { [K in keyof Editable]: K extends PomodoroNumberKey ? string : Editable[K] };

function pick(prefs: Preferences): Editable {
  return {
    theme: prefs.theme ?? 'system',
    date_format: prefs.date_format,
    timeofday_format: prefs.timeofday_format,
    duration_format: prefs.duration_format,
    collapseTimeEntries: prefs.collapseTimeEntries,
    keyboard_shortcuts_enabled: prefs.keyboard_shortcuts_enabled,
    pomodoro_enabled: prefs.pomodoro_enabled ?? false,
    pomodoro_focus_interval_in_minutes: prefs.pomodoro_focus_interval_in_minutes ?? DEFAULT_POMODORO_SETTINGS.workMinutes,
    pomodoro_break_interval_in_minutes: prefs.pomodoro_break_interval_in_minutes ?? DEFAULT_POMODORO_SETTINGS.shortBreakMinutes,
    pomodoro_long_break_interval_in_minutes: prefs.pomodoro_long_break_interval_in_minutes ?? DEFAULT_POMODORO_SETTINGS.longBreakMinutes,
    pomodoro_long_break_every: prefs.pomodoro_long_break_every ?? DEFAULT_POMODORO_SETTINGS.longBreakEvery,
    pomodoro_stop_timer_at_end: prefs.pomodoro_stop_timer_at_end ?? true,
  };
}

function toDraft(values: Editable): Draft {
  return {
    ...values,
    pomodoro_focus_interval_in_minutes: String(values.pomodoro_focus_interval_in_minutes),
    pomodoro_break_interval_in_minutes: String(values.pomodoro_break_interval_in_minutes),
    pomodoro_long_break_interval_in_minutes: String(values.pomodoro_long_break_interval_in_minutes),
    pomodoro_long_break_every: String(values.pomodoro_long_break_every),
  };
}

const isWholeNumber = (text: string) => text.trim() !== '' && Number.isInteger(Number(text.trim()));

/** Whether an edited value is what the server stores, comparing a typed number by its value, not its text. */
function isStored(key: keyof Draft, value: Draft[keyof Draft], stored: Editable): boolean {
  const current = stored[key];
  return typeof current === 'number' ? typeof value === 'string' && isWholeNumber(value) && Number(value.trim()) === current : value === current;
}

/** The request body for the edited fields; a typed number goes as a number. */
function changesFrom(edits: Partial<Draft>): Partial<Preferences> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edits)) {
    changes[key] = typeof value === 'string' && POMODORO_NUMBERS.some((field) => field.key === key) ? Number(value.trim()) : value;
  }
  return changes;
}

/**
 * The form keeps only what the user typed and has not saved; every other field shows the stored
 * value, so a background refetch, such as after a change on another device, updates the untouched
 * fields and leaves the edits and focus alone. A field changed back to the stored value is no longer
 * an edit, except while a save is pending: the stored value may be about to change, so everything
 * typed then stays an edit until the save settles. Saving sends only the edited fields.
 */
export function PreferencesSection({ prefs }: { prefs: Preferences }) {
  const toast = useToast();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const fields = useFieldErrors<PomodoroNumberKey>();
  const save = useSavePreferences();
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const serverDraft = toDraft(pick(prefs));
  const draft: Draft = { ...serverDraft, ...edits };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setEdits((current) => {
    const next = { ...current };
    if (!save.isPending && value === serverDraft[key]) delete next[key];
    else next[key] = value;
    return next;
  });

  // Once a save settles, an edit equal to the stored value is no longer an edit. Anything else typed
  // while the request ran stays, even a value equal to what the server had before the save.
  const dropEditsEqualTo = (stored: Editable) => setEdits((current) => Object.fromEntries(
    Object.entries(current).filter(([key, value]) => !isStored(key as keyof Draft, value, stored)),
  ));

  const todayKey = today(settings.timeZone);
  const now = new Date();
  // A saved format this form doesn't offer stays selectable instead of silently switching.
  const dateFormats: string[] = DATE_FORMATS.includes(draft.date_format as typeof DATE_FORMATS[number])
    ? [...DATE_FORMATS]
    : [draft.date_format, ...DATE_FORMATS];
  const twelveHour = /a/i.test(draft.timeofday_format);

  // Only whole numbers go to the server; it checks the allowed values, and its 400 shows on the
  // field it names, as in "Invalid pomodoro_long_break_every: expected ...".
  const submit = () => {
    const valid = fields.validate(POMODORO_NUMBERS.map(({ key, unit }) => [
      key,
      !isWholeNumber(draft[key]) && `Enter a whole number of ${unit}`,
    ] as const));
    if (!valid) return;
    if (Object.keys(edits).length === 0) {
      toast.show('No changes to save');
      return;
    }
    save.mutate(changesFrom(edits), {
      onSuccess: (saved) => {
        dropEditsEqualTo(pick(saved));
        toast.show('Preferences saved');
      },
      onError: (error) => {
        // The failed save has rolled the cache back to the stored values.
        const stored = queryClient.getQueryData<Preferences>(keys.preferences);
        if (stored) dropEditsEqualTo(pick(stored));
        const refused = POMODORO_NUMBERS.find(({ key }) => error.message.startsWith(`Invalid ${key}:`));
        if (refused) fields.validate([[refused.key, error.message]]);
        else toast.error(error);
      },
    });
  };

  return (
    <SettingsCard id="preferences" title="Preferences" onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        <label className="field">
          <span>Theme</span>
          <select value={draft.theme} onChange={(event) => set('theme', event.target.value as Preferences['theme'])}>
            {THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Date format</span>
          <select value={draft.date_format} onChange={(event) => set('date_format', event.target.value)}>
            {dateFormats.map((format) => (
              <option key={format} value={format}>{format} ({formatDate(todayKey, format)})</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Time format</span>
          <select value={twelveHour ? 'h:mm A' : 'H:mm'} onChange={(event) => set('timeofday_format', event.target.value)}>
            {TIME_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label} ({formatTime(now, { timeZone: settings.timeZone, twelveHour: format.twelveHour })})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Duration format</span>
          <select value={draft.duration_format} onChange={(event) => set('duration_format', event.target.value as DurationFormat)}>
            {DURATION_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>{format.label} ({formatDuration(SAMPLE_SECONDS, format.value)})</option>
            ))}
          </select>
        </label>
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.collapseTimeEntries}
            onChange={(event) => set('collapseTimeEntries', event.target.checked)}
          />
          <span>Group similar time entries in the timer list</span>
        </label>
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.keyboard_shortcuts_enabled}
            onChange={(event) => set('keyboard_shortcuts_enabled', event.target.checked)}
          />
          <span>Keyboard shortcuts</span>
        </label>
      </div>
      <h3 className="settings-subheading" id="pomodoro-title">Pomodoro</h3>
      <div className="form-grid" role="group" aria-labelledby="pomodoro-title">
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.pomodoro_enabled}
            onChange={(event) => set('pomodoro_enabled', event.target.checked)}
          />
          <span>Enable the Pomodoro cycle</span>
        </label>
        {POMODORO_NUMBERS.map(({ key, label }) => (
          <div key={key} className="field">
            <label htmlFor={fields.id(key)}>{label}</label>
            <input
              {...fields.field(key)}
              type="number"
              inputMode="numeric"
              value={draft[key]}
              onChange={(event) => set(key, event.target.value)}
            />
            {fields.message(key)}
          </div>
        ))}
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.pomodoro_stop_timer_at_end}
            onChange={(event) => set('pomodoro_stop_timer_at_end', event.target.checked)}
          />
          <span>Stop the timer at the end of a work phase</span>
        </label>
      </div>
    </SettingsCard>
  );
}
