import { useEffect, useState } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { parseTimeOfDay } from '@tokkl/common/timeOfDay';
import type { DurationFormat } from '../api/types.ts';

/** Text field that accepts any duration grammar from @tokkl/common/duration and commits on blur or Enter. */
export function DurationField({ seconds, onCommit, format = 'improved', disabled, className, ariaLabel }: {
  seconds: number;
  onCommit: (seconds: number) => void;
  format?: DurationFormat;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const shown = formatDuration(seconds, format === 'decimal' ? 'improved' : format);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    const parsed = parseDuration(text);
    if (parsed === null || parsed === seconds) setText(shown);
    else onCommit(parsed);
  };
  return (
    <input
      className={className}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel ?? 'Duration'}
      inputMode="text"
      onFocus={(event) => { setEditing(true); event.target.select(); }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') { setText(shown); setEditing(false); }
      }}
    />
  );
}

/** Clock time field ("9", "930", "9:30", "9pm"); commits minutes after midnight. */
export function TimeField({ minutes, display, onCommit, twelveHour, reference, ariaLabel }: {
  minutes: number;
  display: string;
  onCommit: (minutes: number) => void;
  twelveHour: boolean;
  reference?: number;
  ariaLabel: string;
}) {
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  const commit = () => {
    setEditing(false);
    const parsed = parseTimeOfDay(text, { twelveHour, reference: reference ?? minutes });
    if (parsed === null || parsed === minutes) setText(display);
    else onCommit(parsed);
  };
  return (
    <input
      className="time-field"
      value={text}
      aria-label={ariaLabel}
      onFocus={(event) => { setEditing(true); event.target.select(); }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') { setText(display); setEditing(false); }
      }}
    />
  );
}
