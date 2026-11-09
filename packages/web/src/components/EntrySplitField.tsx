import { useState } from 'react';
import { formatDuration } from '@tokkl/common/duration';
import { addDays } from '@tokkl/common/time';
import { parseTimeOfDay } from '@tokkl/common/timeOfDay';
import { useSplitEntry } from '../api/entries.ts';
import type { TimeEntry } from '@tokkl/types';
import { instantAt, localDay } from '../lib/entryTime.ts';
import { minutesOfDay } from '../lib/format.ts';
import type { Settings } from '../lib/settings.ts';
import { snappedSplit, type SplitHalves } from '../lib/snapping.ts';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';
import type { Exclusive } from './useExclusive.ts';
import { t, type MessageKey } from '../i18n/messages.ts';

const SPLIT_PROBLEMS = {
  unreadable: 'entries.splitUnreadable',
  outside: 'entries.splitOutside',
} as const satisfies Record<string, MessageKey>;

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

/**
 * The entry editor's "Split at" field for a stopped, timed entry, with a preview of both halves.
 * The split runs through the editor's `actions`, so it never overlaps a save, duplicate or delete.
 */
export function EntrySplitField({
  entry,
  settings,
  actions,
  onSplit,
}: {
  entry: TimeEntry & { stop: string };
  settings: Settings;
  actions: Exclusive;
  onSplit: () => void;
}) {
  const [text, setText] = useState('');
  const fields = useFieldErrors<'split'>();
  const split = useSplitEntry();
  const toast = useToast();
  const halves = splitHalves(entry, text, settings);

  const run = () =>
    actions.run(async () => {
      const problem = typeof halves === 'string' && t(SPLIT_PROBLEMS[halves]);
      if (!fields.validate([['split', problem]]) || typeof halves === 'string') return;
      try {
        await split.mutateAsync({ entry, halves });
        toast.show(t('entries.splitDone'));
        onSplit();
      } catch (error) {
        toast.error(error);
      }
    });

  return (
    <div className="field field-full">
      <label htmlFor={fields.id('split')}>{t('entries.splitAt')}</label>
      <div className="inline-controls">
        <input
          {...fields.field('split')}
          value={text}
          placeholder={t('entries.splitPlaceholder')}
          onChange={event => setText(event.target.value)}
        />
        <button type="button" className="button button-ghost" onClick={() => void run()} disabled={actions.busy}>
          <Icon name="split" size={16} /> {t('entries.split')}
        </button>
      </div>
      {typeof halves !== 'string' ? (
        <p className="hint">
          {t('entries.splitsInto', {
            first: formatDuration(spanSeconds(halves.first)),
            second: formatDuration(spanSeconds(halves.second)),
          })}
        </p>
      ) : null}
      {fields.message('split')}
    </div>
  );
}
