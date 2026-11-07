import { useCallback, useState } from 'react';
import { formatDuration } from '@tokkl/common/duration';
import { useCreateEntry } from '../api/entries.ts';
import type { TimeEntryInput } from '../api/types.ts';
import { useClockSelector } from '../lib/clock.ts';
import { localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { formatTime, minutesOfDay, today } from '../lib/format.ts';
import { noTimeDuration } from '../lib/noTimeDuration.ts';
import type { Settings } from '../lib/settings.ts';
import { entrySeconds, snappedSeconds } from '../lib/snapping.ts';
import { useFieldErrors } from './FieldError.tsx';
import { useToast } from './Toast.tsx';
import type { EntryDraft } from './useEntryFields.ts';

const START_END_MESSAGE = 'Enter a start and end time, like 9:00 and 10:30';

/**
 * The manual form of the timer bar: a date with a start and end time, or with "No times" a
 * duration. `add` saves the draft with those times; after a timed entry the next one starts where
 * the stored one stopped.
 */
export function useManualEntry(settings: Settings, { onAdded }: { onAdded: () => void }) {
  const create = useCreateEntry();
  const toast = useToast();
  const [day, setDay] = useState(() => today(settings.timeZone));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [noTimes, setNoTimes] = useState(false);
  const [durationText, setDurationText] = useState('');
  const errors = useFieldErrors<'start' | 'end' | 'duration'>();

  const save = async (input: TimeEntryInput, shownStop: Date) => {
    const saved = await create.mutateAsync(input);
    // The server snaps the entry to the time resolution, so the toast shows what it stored.
    toast.show(`Added ${formatDuration(entrySeconds(saved, shownStop))}`);
    onAdded();
    return saved;
  };

  /** Adds a no-time entry for the chosen day. The next start stays where the last timed entry ended. */
  const addNoTimes = async (draft: EntryDraft) => {
    const { seconds, error } = noTimeDuration(durationText, settings.timeResolution);
    if (!errors.validate([['duration', error]]) || seconds === null) return;
    try {
      await save({ ...draft, all_day: true, start_date: day, duration: seconds }, new Date());
      setDurationText('');
    } catch (failure) {
      toast.error(failure);
    }
  };

  const add = async (draft: EntryDraft) => {
    if (noTimes) return addNoTimes(draft);
    const options = {
      timeZone: settings.timeZone,
      twelveHour: settings.twelveHour,
      nowMinutes: minutesOfDay(new Date(), settings.timeZone),
    };
    const range = resolveRange(day, start, end, options);
    const unreadable = !range && unreadableTime(start, options);
    errors.validate([
      ['start', unreadable === 'start' && START_END_MESSAGE],
      ['end', unreadable === 'end' && START_END_MESSAGE],
    ]);
    if (!range) return;
    try {
      const saved = await save(
        { ...draft, start: range.start.toISOString(), stop: range.stop.toISOString() },
        range.stop,
      );
      // The next entry starts where the stored one stopped, which is the next day after midnight.
      // The server snaps the times, so starting at the typed end could overlap the stored entry.
      const stop = saved.stop ? new Date(saved.stop) : range.stop;
      setDay(localDay(stop, settings.timeZone));
      setStart(formatTime(stop, settings));
      setEnd('');
    } catch (failure) {
      toast.error(failure);
    }
  };

  const switchNoTimes = (on: boolean) => {
    setNoTimes(on);
    (['start', 'end', 'duration'] as const).forEach(errors.clear);
  };

  return {
    day,
    setDay,
    start,
    setStart,
    end,
    setEnd,
    noTimes,
    switchNoTimes,
    durationText,
    setDurationText,
    errors,
    add,
  };
}

export type ManualEntry = ReturnType<typeof useManualEntry>;

/** The manual form's fields inside the timer bar's controls row. */
export function ManualEntryFields({
  manual,
  settings,
  onEnter,
}: {
  manual: ManualEntry;
  settings: Settings;
  onEnter: () => void;
}) {
  const { errors } = manual;
  // The end of a typed range resolves against the current minute, so the preview follows it.
  const nowMinutes = useClockSelector(
    1000,
    useCallback(now => minutesOfDay(new Date(now), settings.timeZone), [settings.timeZone]),
  );
  const range = manual.noTimes
    ? null
    : resolveRange(manual.day, manual.start, manual.end, {
        timeZone: settings.timeZone,
        twelveHour: settings.twelveHour,
        nowMinutes,
      });
  const onKeyDown = (event: { key: string }) => {
    if (event.key === 'Enter') onEnter();
  };

  return (
    <div className="manual-fields">
      <label className="manual-switch">
        <input
          type="checkbox"
          role="switch"
          checked={manual.noTimes}
          onChange={event => manual.switchNoTimes(event.target.checked)}
        />
        No times
      </label>
      <input
        type="date"
        aria-label="Date"
        value={manual.day}
        onChange={event => event.target.value && manual.setDay(event.target.value)}
      />
      {manual.noTimes ? (
        <input
          {...errors.field('duration')}
          className="time-field manual-duration-field"
          aria-label="Duration"
          placeholder="Duration"
          value={manual.durationText}
          onChange={event => manual.setDurationText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <>
          <input
            {...errors.field('start')}
            className="time-field"
            aria-label="Start time"
            placeholder="Start"
            value={manual.start}
            onChange={event => manual.setStart(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="muted">–</span>
          <input
            {...errors.field('end')}
            className="time-field"
            aria-label="End time"
            placeholder="End"
            value={manual.end}
            onChange={event => manual.setEnd(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </>
      )}
      <span className="manual-duration">
        {manual.noTimes
          ? formatDuration(noTimeDuration(manual.durationText, settings.timeResolution).seconds ?? 0)
          : range
            ? formatDuration(snappedSeconds(range.start, range.stop, settings))
            : '0:00:00'}
      </span>
      {range && localDay(range.stop, settings.timeZone) !== manual.day ? <span className="hint">+1 day</span> : null}
      {errors.message('start')}
      {errors.message('end')}
      {errors.message('duration')}
    </div>
  );
}
