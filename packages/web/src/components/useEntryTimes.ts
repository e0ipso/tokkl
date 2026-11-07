import { useState } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { snapDuration } from '@tokkl/common/snap';
import { parseTimeOfDay } from '@tokkl/common/timeOfDay';
import type { TimeEntry, TimeEntryInput } from '../api/types.ts';
import { instantAt, localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { formatTime, minutesOfDay } from '../lib/format.ts';
import { noTimeSeconds } from '../lib/noTimeDuration.ts';
import { noTimeFields } from '../lib/noTimeEdit.ts';
import type { Settings } from '../lib/settings.ts';
import { entrySeconds, snappedSeconds } from '../lib/snapping.ts';
import type { FieldCheck } from './FieldError.tsx';

export type TimeFieldKey = 'start' | 'end' | 'duration';

type Validate = (checks: ReadonlyArray<FieldCheck<TimeFieldKey>>) => boolean;

/**
 * The date, start, end and duration fields of the entry editor, and the times a save sends.
 *
 * Times are typed to the minute, so only changed fields go back to the server: sending an
 * unchanged start would drop its seconds, or pick the wrong hour when a DST change makes the wall
 * time ambiguous. Saving snaps the entry to the time resolution, so the duration shows the snapped
 * length. A no-time entry shows only its day and stored duration.
 */
export function useEntryTimes(entry: TimeEntry, settings: Settings, now: Date) {
  const running = entry.stop === null;
  const [initial] = useState(() => ({
    day: localDay(entry.start, settings.timeZone),
    start: entry.all_day ? '' : formatTime(entry.start, settings),
    end: entry.stop && !entry.all_day ? formatTime(entry.stop, settings) : '',
    duration: entry.all_day
      ? ''
      : formatDuration(
          entry.stop ? snappedSeconds(new Date(entry.start), new Date(entry.stop), settings) : entrySeconds(entry, now),
        ),
    // The duration a no-time entry is stored with, which a no-time save sends when it changes.
    noTimeLength: entry.all_day
      ? snapDuration(entrySeconds(entry, now), settings.timeResolution)
      : entry.stop
        ? snappedSeconds(new Date(entry.start), new Date(entry.stop), settings)
        : 0,
  }));
  const [day, setDay] = useState(initial.day);
  const [noTimes, setNoTimes] = useState(entry.all_day);
  const [startText, setStartText] = useState(initial.start);
  const [endText, setEndText] = useState(initial.end);
  const [durationText, setDurationText] = useState(initial.duration);
  // The duration last derived from start and end, so a typed duration is told apart from it.
  const [syncedDuration, setSyncedDuration] = useState(initial.duration);
  const [noTimeLength, setNoTimeLength] = useState(initial.noTimeLength);

  const timeOptions = {
    timeZone: settings.timeZone,
    twelveHour: settings.twelveHour,
    nowMinutes: minutesOfDay(now, settings.timeZone),
  };
  const range = (() => {
    if (noTimes) return null;
    if (running) {
      const minutes = parseTimeOfDay(startText, { twelveHour: settings.twelveHour, reference: timeOptions.nowMinutes });
      return minutes === null ? null : { start: instantAt(day, minutes, settings.timeZone), stop: null };
    }
    return resolveRange(day, startText, endText, timeOptions);
  })();

  const startChanged = day !== initial.day || startText !== initial.start;
  const endChanged = day !== initial.day || endText !== initial.end;
  const durationChanged = durationText !== syncedDuration;

  /** Start or end lost focus: the duration follows them. */
  const syncDuration = () => {
    if (!range?.stop || (!startChanged && !endChanged)) return;
    const text = formatDuration(snappedSeconds(range.start, range.stop, settings));
    setDurationText(text);
    setSyncedDuration(text);
  };

  /** The duration lost focus: the end follows it. */
  const applyDuration = () => {
    if (!durationChanged) return;
    const seconds = parseDuration(durationText);
    if (seconds === null || !range) return;
    const start = startChanged ? range.start : new Date(entry.start);
    const stop = new Date(start.getTime() + seconds * 1000);
    setEndText(formatTime(stop, settings));
    setDurationText(formatDuration(snappedSeconds(start, stop, settings)));
  };

  /** Switches No times. A timed entry keeps its date and takes the length its fields show now. */
  const toggleNoTimes = (on: boolean) => {
    setNoTimes(on);
    if (!on || entry.all_day) return;
    const typed = parseDuration(durationText);
    if (typed) setNoTimeLength(snapDuration(typed, settings.timeResolution));
  };

  const setNoTimeSeconds = (seconds: number) => setNoTimeLength(snapDuration(seconds, settings.timeResolution));

  /**
   * The time fields a save sends, or null after `validate` showed what to fix. Only a changed day,
   * start, end or duration is sent.
   */
  const changes = (validate: Validate): TimeEntryInput | null => {
    if (noTimes) {
      const send = noTimeFields(
        entry,
        { day, seconds: noTimeLength },
        { day: initial.day, seconds: initial.noTimeLength },
      );
      // Only a changed day or duration is sent, so only then must it be valid.
      const { error } = noTimeSeconds(noTimeLength, settings.timeResolution);
      return validate([['duration', send.all_day && error]]) ? send : null;
    }
    const unreadable = !range && (running ? 'start' : unreadableTime(startText, timeOptions));
    const seconds = !running && durationChanged ? parseDuration(durationText) : null;
    const timesMessage = 'Check the start and end times';
    const valid = validate([
      ['start', unreadable === 'start' && timesMessage],
      ['end', unreadable === 'end' && timesMessage],
      ['duration', !running && durationChanged && seconds === null && 'Check the duration'],
    ]);
    if (!valid || !range) return null;
    const times: TimeEntryInput = {};
    // Leaving no-time mode needs both ends, which the range already guarantees.
    if (entry.all_day) times.all_day = false;
    const start = startChanged ? range.start : new Date(entry.start);
    if (startChanged) times.start = start.toISOString();
    if (!running) {
      if (seconds !== null) times.stop = new Date(start.getTime() + seconds * 1000).toISOString();
      else if (endChanged && range.stop) times.stop = range.stop.toISOString();
    }
    return times;
  };

  return {
    running,
    day,
    setDay,
    noTimes,
    toggleNoTimes,
    startText,
    setStartText,
    endText,
    setEndText,
    durationText,
    setDurationText,
    noTimeLength,
    setNoTimeSeconds,
    range,
    syncDuration,
    applyDuration,
    changes,
  };
}
