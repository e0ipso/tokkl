import { useState, type ComponentPropsWithRef } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import type { DurationFormat } from '../api/types.ts';
import { t } from '../i18n/messages.ts';

/**
 * Text field that accepts any duration grammar from @tokkl/common/duration and commits on blur or
 * Enter. While the user is not editing it shows `seconds`, so a saved or refetched value replaces
 * the text; while editing it shows what was typed.
 */
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
  /** Extra props for the input, such as the id, ref and aria attributes of a form field. */
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
