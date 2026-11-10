import { formatDuration } from '@tokkl/common/duration';
import type { PomodoroLimits } from '@tokkl/types';
import type { useFieldErrors } from '../../../components/FieldError.tsx';
import { LengthStepper, LengthStepperGrid } from '../../../components/LengthStepper.tsx';
import { formatDate, formatTime } from '../../../lib/format.ts';
import { isTwelveHour } from '../../../lib/settings.ts';
import {
  DURATION_FORMATS,
  POMODORO_NUMBERS,
  THEMES,
  TIME_FORMATS,
  dateFormatOptions,
  type Draft,
  type NumberKey,
} from './preferencesForm.ts';
import { t } from '../../../i18n/messages.ts';

/** The example Toggl uses for its duration formats. */
const SAMPLE_SECONDS = 47 * 60 + 6;

interface PreferenceFieldsProps {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

type NumberFieldErrors = ReturnType<typeof useFieldErrors<NumberKey>>;

export function DisplayFields({
  draft,
  set,
  timeZone,
  todayKey,
}: PreferenceFieldsProps & { timeZone: string; todayKey: string }) {
  const now = new Date();
  const twelveHour = isTwelveHour(draft.timeofday_format);
  return (
    <div className="form-grid">
      <label className="field">
        <span>{t('settings.theme')}</span>
        <select
          value={draft.theme}
          onChange={event => {
            const theme = THEMES.find(option => option.value === event.target.value);
            if (theme) set('theme', theme.value);
          }}
        >
          {THEMES.map(theme => (
            <option key={theme.value} value={theme.value}>
              {t(theme.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('settings.dateFormat')}</span>
        <select value={draft.date_format} onChange={event => set('date_format', event.target.value)}>
          {dateFormatOptions(draft.date_format).map(format => (
            <option key={format} value={format}>
              {t('settings.formatOption', { label: format, sample: formatDate(todayKey, format) })}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('settings.timeFormat')}</span>
        <select value={twelveHour ? 'h:mm A' : 'H:mm'} onChange={event => set('timeofday_format', event.target.value)}>
          {TIME_FORMATS.map(format => (
            <option key={format.value} value={format.value}>
              {t('settings.formatOption', {
                label: t(format.label),
                sample: formatTime(now, { timeZone, twelveHour: format.twelveHour }),
              })}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('settings.durationFormat')}</span>
        <select
          value={draft.duration_format}
          onChange={event => {
            const format = DURATION_FORMATS.find(option => option.value === event.target.value);
            if (format) set('duration_format', format.value);
          }}
        >
          {DURATION_FORMATS.map(format => (
            <option key={format.value} value={format.value}>
              {t('settings.formatOption', {
                label: t(format.label),
                sample: formatDuration(SAMPLE_SECONDS, format.value),
              })}
            </option>
          ))}
        </select>
      </label>
      <label className="field checkbox-field field-full">
        <input
          type="checkbox"
          checked={draft.collapseTimeEntries}
          onChange={event => set('collapseTimeEntries', event.target.checked)}
        />
        <span>{t('settings.groupSimilar')}</span>
      </label>
      <label className="field checkbox-field field-full">
        <input
          type="checkbox"
          checked={draft.keyboard_shortcuts_enabled}
          onChange={event => set('keyboard_shortcuts_enabled', event.target.checked)}
        />
        <span>{t('settings.keyboardShortcuts')}</span>
      </label>
    </div>
  );
}

export function TimerReminderFields({ draft, set, fields }: PreferenceFieldsProps & { fields: NumberFieldErrors }) {
  return (
    <>
      <h3 className="settings-subheading" id="timer-reminder-title">
        {t('settings.longRunningTimers')}
      </h3>
      <div className="form-grid" role="group" aria-labelledby="timer-reminder-title">
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.long_timer_reminder_enabled}
            onChange={event => set('long_timer_reminder_enabled', event.target.checked)}
          />
          <span>{t('settings.remindLongRunning')}</span>
        </label>
        <div className="field">
          <label htmlFor={fields.id('long_timer_reminder_hours')}>{t('settings.remindAfter')}</label>
          <input
            {...fields.field('long_timer_reminder_hours')}
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            value={draft.long_timer_reminder_hours}
            onChange={event => set('long_timer_reminder_hours', event.target.value)}
          />
          {fields.message('long_timer_reminder_hours')}
        </div>
        <p className="hint field-full">{t('settings.remindHint')}</p>
      </div>
    </>
  );
}

/** Within the server's `limits`. */
export function PomodoroDefaults({
  draft,
  set,
  fields,
  limits,
}: PreferenceFieldsProps & { fields: NumberFieldErrors; limits: PomodoroLimits }) {
  return (
    <>
      <h3 className="settings-subheading" id="pomodoro-title">
        {t('settings.pomodoroDefaults')}
      </h3>
      <LengthStepperGrid aria-labelledby="pomodoro-title">
        {POMODORO_NUMBERS.map(({ key, label, shortUnit, unit, limit }) => (
          <LengthStepper
            key={key}
            label={t(label)}
            unit={t(shortUnit)}
            spokenUnit={t(unit)}
            range={limits[limit]}
            value={draft[key]}
            onChange={text => {
              set(key, text);
              fields.clear(key);
            }}
            inputProps={fields.field(key)}
            error={fields.message(key)}
          />
        ))}
      </LengthStepperGrid>
      <p className="hint settings-hint">{t('settings.pomodoroHint')}</p>
    </>
  );
}
