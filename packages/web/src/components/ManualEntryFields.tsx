import { useCallback, useState } from 'react';
import { formatDuration } from '@tokkl/common/duration';
import { useCreateEntry } from '../api/entries.ts';
import type { TimeEntryInput } from '@tokkl/types';
import { useClockSelector } from '../lib/clock.ts';
import { localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { formatTime, minutesOfDay, today } from '../lib/format.ts';
import { noTimeDuration } from '../lib/noTimeDuration.ts';
import type { Settings } from '../lib/settings.ts';
import { entrySeconds, snappedSeconds } from '../lib/snapping.ts';
import { useFieldErrors } from './FieldError.tsx';
import { useToast } from './Toast.tsx';
import { useExclusive } from './useExclusive.ts';
import type { EntryDraft } from './useEntryFields.ts';
import { t } from '../i18n/messages.ts';

/** After a timed entry the next one starts where the stored one stopped. */
export function useManualEntry(settings: Settings, { onAdded }: { onAdded: () => void }) {
  const create = useCreateEntry();
  const toast = useToast();
  const [day, setDay] = useState(() => today(settings.timeZone));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [noTimes, setNoTimes] = useState(false);
  const [durationText, setDurationText] = useState('');
  const errors = useFieldErrors<'start' | 'end' | 'duration'>();
  // A double click on Add or a repeated Enter adds the entry once.
  const adding = useExclusive();

  const save = async (input: TimeEntryInput, shownStop: Date) => {
    const saved = await create.mutateAsync(input);
    // The server snaps the entry to the time resolution, so the toast shows what it stored.
    toast.show(t('entries.added', { duration: formatDuration(entrySeconds(saved, shownStop)) }));
    onAdded();
    return saved;
  };

  /** The next start stays where the last timed entry ended. */
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

  const addDraft = async (draft: EntryDraft) => {
    if (noTimes) return addNoTimes(draft);
    const options = {
      timeZone: settings.timeZone,
      twelveHour: settings.twelveHour,
      nowMinutes: minutesOfDay(new Date(), settings.timeZone),
    };
    const range = resolveRange(day, start, end, options);
    const unreadable = !range && unreadableTime(start, options);
    errors.validate([
      ['start', unreadable === 'start' && t('timer.manualStartEnd')],
      ['end', unreadable === 'end' && t('timer.manualStartEnd')],
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

  const add = (draft: EntryDraft) => adding.run(() => addDraft(draft));

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

type ManualEntry = ReturnType<typeof useManualEntry>;

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
        {t('timer.noTimes')}
      </label>
      <input
        type="date"
        aria-label={t('timer.date')}
        value={manual.day}
        onChange={event => event.target.value && manual.setDay(event.target.value)}
      />
      {manual.noTimes ? (
        <input
          {...errors.field('duration')}
          className="time-field manual-duration-field"
          aria-label={t('timer.duration')}
          placeholder={t('timer.duration')}
          value={manual.durationText}
          onChange={event => manual.setDurationText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <>
          <input
            {...errors.field('start')}
            className="time-field"
            aria-label={t('timer.startTime')}
            placeholder={t('timer.startPlaceholder')}
            value={manual.start}
            onChange={event => manual.setStart(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="muted">–</span>
          <input
            {...errors.field('end')}
            className="time-field"
            aria-label={t('timer.endTime')}
            placeholder={t('timer.endPlaceholder')}
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
      {range && localDay(range.stop, settings.timeZone) !== manual.day ? (
        <span className="hint">{t('timer.nextDay')}</span>
      ) : null}
      {errors.message('start')}
      {errors.message('end')}
      {errors.message('duration')}
    </div>
  );
}
