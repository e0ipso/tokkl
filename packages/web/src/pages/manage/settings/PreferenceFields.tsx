import { formatDuration } from '@tokkl/common/duration';
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

/** 47 minutes and 6 seconds, the example Toggl uses for its duration formats. */
const SAMPLE_SECONDS = 47 * 60 + 6;

/** What every group of preference fields reads and writes. */
export interface PreferenceFieldsProps {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

/** The number fields' error state, from `useFieldErrors`. */
export type NumberFieldErrors = ReturnType<typeof useFieldErrors<NumberKey>>;

/** Theme, date, time and duration formats, and the list and shortcut switches. */
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
        <span>Theme</span>
        <select
          value={draft.theme}
          onChange={event => {
            const theme = THEMES.find(option => option.value === event.target.value);
            if (theme) set('theme', theme.value);
          }}
        >
          {THEMES.map(theme => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Date format</span>
        <select value={draft.date_format} onChange={event => set('date_format', event.target.value)}>
          {dateFormatOptions(draft.date_format).map(format => (
            <option key={format} value={format}>
              {format} ({formatDate(todayKey, format)})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Time format</span>
        <select value={twelveHour ? 'h:mm A' : 'H:mm'} onChange={event => set('timeofday_format', event.target.value)}>
          {TIME_FORMATS.map(format => (
            <option key={format.value} value={format.value}>
              {format.label} ({formatTime(now, { timeZone, twelveHour: format.twelveHour })})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Duration format</span>
        <select
          value={draft.duration_format}
          onChange={event => {
            const format = DURATION_FORMATS.find(option => option.value === event.target.value);
            if (format) set('duration_format', format.value);
          }}
        >
          {DURATION_FORMATS.map(format => (
            <option key={format.value} value={format.value}>
              {format.label} ({formatDuration(SAMPLE_SECONDS, format.value)})
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
        <span>Group similar time entries in the timer list</span>
      </label>
      <label className="field checkbox-field field-full">
        <input
          type="checkbox"
          checked={draft.keyboard_shortcuts_enabled}
          onChange={event => set('keyboard_shortcuts_enabled', event.target.checked)}
        />
        <span>Keyboard shortcuts</span>
      </label>
    </div>
  );
}

/** The reminder for a timer left running, and after how many hours it comes. */
export function TimerReminderFields({ draft, set, fields }: PreferenceFieldsProps & { fields: NumberFieldErrors }) {
  return (
    <>
      <h3 className="settings-subheading" id="timer-reminder-title">
        Long-running timers
      </h3>
      <div className="form-grid" role="group" aria-labelledby="timer-reminder-title">
        <label className="field checkbox-field field-full">
          <input
            type="checkbox"
            checked={draft.long_timer_reminder_enabled}
            onChange={event => set('long_timer_reminder_enabled', event.target.checked)}
          />
          <span>Remind me to check long-running timers</span>
        </label>
        <div className="field">
          <label htmlFor={fields.id('long_timer_reminder_hours')}>Remind me after (hours)</label>
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
        <p className="hint field-full">
          Choose 1 to 168 hours. Tokkl asks once per timer while this app is open. Confirming keeps the timer running.
        </p>
      </div>
    </>
  );
}

/** The lengths a new Pomodoro session starts with. */
export function PomodoroDefaults({ draft, set, fields }: PreferenceFieldsProps & { fields: NumberFieldErrors }) {
  return (
    <>
      <h3 className="settings-subheading" id="pomodoro-title">
        Pomodoro session defaults
      </h3>
      <LengthStepperGrid aria-labelledby="pomodoro-title">
        {POMODORO_NUMBERS.map(({ key, label, shortUnit, unit, range }) => (
          <LengthStepper
            key={key}
            label={label}
            unit={shortUnit}
            spokenUnit={unit}
            range={range}
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
      <p className="hint settings-hint">
        New sessions on the Pomodoro page start with these lengths. You can change them there before you start.
      </p>
    </>
  );
}
