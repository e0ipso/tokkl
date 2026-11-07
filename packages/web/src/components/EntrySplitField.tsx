import { useState } from 'react';
import { formatDuration } from '@tokkl/common/duration';
import { addDays } from '@tokkl/common/time';
import { parseTimeOfDay } from '@tokkl/common/timeOfDay';
import { useSplitEntry } from '../api/entries.ts';
import type { TimeEntry } from '../api/types.ts';
import { instantAt, localDay } from '../lib/entryTime.ts';
import { minutesOfDay } from '../lib/format.ts';
import type { Settings } from '../lib/settings.ts';
import { snappedSplit, type SplitHalves } from '../lib/snapping.ts';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';

const SPLIT_PROBLEMS = {
  unreadable: 'Enter a split time like 10:30',
  outside: 'The split time must fall inside the entry',
} as const;

function spanSeconds(span: { start: Date; stop: Date }): number {
  return (span.stop.getTime() - span.start.getTime()) / 1000;
}

/**
 * The halves a typed split time cuts a stopped entry into, as the server will store them, or why it
 * cuts nowhere. The time moves to the nearest grid point of the time resolution, so both halves keep
 * it as their shared boundary when the server snaps them.
 */
function splitHalves(
  entry: TimeEntry & { stop: string },
  text: string,
  settings: Settings,
): SplitHalves | keyof typeof SPLIT_PROBLEMS {
  const minutes = parseTimeOfDay(text, {
    twelveHour: settings.twelveHour,
    reference: minutesOfDay(entry.start, settings.timeZone),
  });
  if (minutes === null) return 'unreadable';
  const startDay = localDay(entry.start, settings.timeZone);
  let at = instantAt(startDay, minutes, settings.timeZone);
  // Overnight: the same clock time on the next calendar day. Adding 24 hours would be off by the
  // DST shift when the clocks change that night.
  if (at <= new Date(entry.start)) at = instantAt(addDays(startDay, 1), minutes, settings.timeZone);
  return snappedSplit(new Date(entry.start), new Date(entry.stop), at, settings);
}

/** The entry editor's "Split at" field for a stopped, timed entry, with a preview of both halves. */
export function EntrySplitField({
  entry,
  settings,
  onSplit,
}: {
  entry: TimeEntry & { stop: string };
  settings: Settings;
  onSplit: () => void;
}) {
  const [text, setText] = useState('');
  const fields = useFieldErrors<'split'>();
  const split = useSplitEntry();
  const toast = useToast();
  const halves = splitHalves(entry, text, settings);

  const run = async () => {
    const problem = typeof halves === 'string' && SPLIT_PROBLEMS[halves];
    if (!fields.validate([['split', problem]]) || typeof halves === 'string') return;
    try {
      await split.mutateAsync({ entry, halves });
      toast.show('Entry split in two');
      onSplit();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="field field-full">
      <label htmlFor={fields.id('split')}>Split at</label>
      <div className="inline-controls">
        <input
          {...fields.field('split')}
          value={text}
          placeholder="e.g. 10:30"
          onChange={event => setText(event.target.value)}
        />
        <button type="button" className="button button-ghost" onClick={() => void run()}>
          <Icon name="split" size={16} /> Split
        </button>
      </div>
      {typeof halves !== 'string' ? (
        <p className="hint">
          Splits into {formatDuration(spanSeconds(halves.first))} and {formatDuration(spanSeconds(halves.second))}.
        </p>
      ) : null}
      {fields.message('split')}
    </div>
  );
}
