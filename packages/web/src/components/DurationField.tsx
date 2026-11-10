import { useState, type ComponentPropsWithRef } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import type { DurationFormat } from '@tokkl/types';
import { t } from '../i18n/messages.ts';

/** Accepts any @tokkl/common/duration grammar and commits on blur or Enter; shows `seconds` while not editing. */
export function DurationField({
  seconds,
  onCommit,
  format = 'improved',
  disabled,
  className,
  ariaLabel,
  inputProps,
}: {
  seconds: number;
  onCommit: (seconds: number) => void;
  format?: DurationFormat;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Such as the id, ref and aria attributes of a form field. */
  inputProps?: Omit<ComponentPropsWithRef<'input'>, 'value' | 'onChange' | 'onBlur' | 'onFocus' | 'onKeyDown'>;
}) {
  const shown = formatDuration(seconds, format === 'decimal' ? 'improved' : format);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const commit = () => {
    setEditing(false);
    const parsed = parseDuration(text);
    if (parsed !== null && parsed !== seconds) onCommit(parsed);
  };
  return (
    <input
      {...inputProps}
      className={className}
      value={editing ? text : shown}
      disabled={disabled}
      aria-label={ariaLabel ?? t('entries.duration')}
      inputMode="text"
      onFocus={event => {
        setText(shown);
        setEditing(true);
        event.target.select();
      }}
      onChange={event => {
        setText(event.target.value);
        setEditing(true);
      }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setText(shown);
          setEditing(false);
        }
      }}
    />
  );
}
