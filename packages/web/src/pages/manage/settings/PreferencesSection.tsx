import { useState } from 'react';
import { useSavePreferences } from '../../../api/hooks.ts';
import type { DurationFormat, Preferences } from '../../../api/types.ts';
import { useToast } from '../../../components/Toast.tsx';
import { formatDate, formatTime, today, useSettings } from '../../../lib/settings.ts';
import { formatDuration } from '@tokkl/common/duration';
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

type Editable = Pick<Preferences,
  'theme' | 'date_format' | 'timeofday_format' | 'duration_format' | 'collapseTimeEntries' | 'keyboard_shortcuts_enabled'>;

function pick(prefs: Preferences): Editable {
  return {
    theme: prefs.theme ?? 'system',
    date_format: prefs.date_format,
    timeofday_format: prefs.timeofday_format,
    duration_format: prefs.duration_format,
    collapseTimeEntries: prefs.collapseTimeEntries,
    keyboard_shortcuts_enabled: prefs.keyboard_shortcuts_enabled,
  };
}

export function PreferencesSection({ prefs }: { prefs: Preferences }) {
  const toast = useToast();
  const settings = useSettings();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<Editable>(() => pick(prefs));
  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const todayKey = today(settings.timeZone);
  const now = new Date();
  // A saved format this form doesn't offer stays selectable instead of silently switching.
  const dateFormats: string[] = DATE_FORMATS.includes(draft.date_format as typeof DATE_FORMATS[number])
    ? [...DATE_FORMATS]
    : [draft.date_format, ...DATE_FORMATS];
  const twelveHour = /a/i.test(draft.timeofday_format);

  const submit = () => {
    save.mutate(draft, {
      onSuccess: () => toast.show('Preferences saved'),
      onError: (error) => toast.error(error),
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
    </SettingsCard>
  );
}
