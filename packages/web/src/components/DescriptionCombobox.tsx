import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import type { TimeEntry } from '@tokkl/types';
import { comboboxKeyAction } from './descriptionCombobox.ts';
import { ProjectDot } from './ProjectLabel.tsx';
import { useDescriptionSuggestions, type Suggestion } from './useEntryFields.ts';
import { t } from '../i18n/messages.ts';

export interface DescriptionComboboxHandle {
  focus: () => void;
  /** Focus without opening the suggestions, as when a picker hands focus back. */
  focusQuietly: () => void;
  hasFocus: () => boolean;
  hideSuggestions: () => void;
}

/**
 * A description input with recent-entry suggestions as its popup listbox. The owner keeps `value` and decides
 * what a pick writes. Enter with no highlighted suggestion calls `onEnter`; keys the combobox does not use go
 * to `onExtraKeyDown`. Escape with the list open closes only the list, so an enclosing dialog stays open.
 */
export const DescriptionCombobox = forwardRef<
  DescriptionComboboxHandle,
  {
    value: string;
    recentEntries: TimeEntry[];
    onType: (description: string) => void;
    onPick: (suggestion: Suggestion) => void;
    onBlur?: () => void;
    onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onExtraKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    /** The first focus after mount, such as a dialog's autofocus, does not open the list. */
    quietFirstFocus?: boolean;
    className?: string;
    inputClassName?: string;
    placeholder?: string;
    readOnly?: boolean;
    maxLength?: number;
    'aria-label'?: string;
  }
>(function DescriptionCombobox(
  {
    value,
    recentEntries,
    onType,
    onPick,
    onBlur,
    onEnter,
    onExtraKeyDown,
    quietFirstFocus = false,
    className = 'description-combobox',
    inputClassName,
    placeholder,
    readOnly = false,
    maxLength = 3000,
    'aria-label': ariaLabel = t('entries.description'),
  },
  ref,
) {
  const { suggestions, setShowSuggestions, highlight, setHighlight } = useDescriptionSuggestions({
    value,
    recentEntries,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Blur hides the suggestions after a delay so a click on one lands; a quiet focus does not open them.
  const hideSuggestionsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quietFocus = useRef(false);
  const firstFocus = useRef(true);
  // The field holds a quiet focus: a click on it, which fires no focus event, opens the list.
  const heldQuietly = useRef(false);
  useEffect(() => () => clearTimeout(hideSuggestionsTimer.current), []);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    focusQuietly: () => {
      quietFocus.current = true;
      inputRef.current?.focus();
      quietFocus.current = false;
    },
    hasFocus: () => document.activeElement === inputRef.current,
    hideSuggestions: () => setShowSuggestions(false),
  }));

  const pickSuggestion = (s: Suggestion) => {
    setShowSuggestions(false);
    setHighlight(-1);
    onPick(s);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = comboboxKeyAction(event.key, suggestions.length, highlight);
    switch (action.kind) {
      case 'highlight':
        event.preventDefault();
        setHighlight(action.index);
        break;
      case 'pick':
        event.preventDefault();
        pickSuggestion(suggestions[action.index]!);
        break;
      case 'enter':
        event.preventDefault();
        onEnter?.(event);
        break;
      case 'close':
        // React listens on the root or portal container, below the document where Modal listens for Escape.
        event.stopPropagation();
        setShowSuggestions(false);
        break;
      case 'ignore':
        onExtraKeyDown?.(event);
        break;
    }
  };

  return (
    <div className={className}>
      <input
        ref={inputRef}
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        // The suggestions are its popup listbox, as in the project picker's search field.
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={suggestions[highlight] ? `${listId}-${highlight}` : undefined}
        maxLength={maxLength}
        readOnly={readOnly}
        onChange={event => {
          heldQuietly.current = false;
          onType(event.target.value);
          setShowSuggestions(true);
          setHighlight(-1);
        }}
        onFocus={() => {
          clearTimeout(hideSuggestionsTimer.current);
          const quiet = quietFocus.current || (quietFirstFocus && firstFocus.current);
          firstFocus.current = false;
          heldQuietly.current = quiet;
          setShowSuggestions(!quiet && !readOnly);
        }}
        onClick={() => {
          if (!heldQuietly.current) return;
          heldQuietly.current = false;
          setShowSuggestions(!readOnly);
        }}
        onBlur={() => {
          heldQuietly.current = false;
          hideSuggestionsTimer.current = setTimeout(() => setShowSuggestions(false), 150);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 ? (
        <ul className="suggestions" role="listbox" id={listId} aria-label={t('entries.suggestions')}>
          {suggestions.map((s, i) => (
            <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // Options are not tab stops: Tab leaves the field for the next control, as in a combobox.
                tabIndex={-1}
                className={`suggestion${i === highlight ? ' highlighted' : ''}`}
                onMouseDown={event => {
                  // Keep focus in the field for any button; only the primary one picks, so a right click writes nothing.
                  event.preventDefault();
                  if (event.button !== 0) return;
                  pickSuggestion(s);
                }}
              >
                <span>{s.description || <em className="muted">{t('entries.noDescription')}</em>}</span>
                {s.project_id ? (
                  <span className="suggestion-project">
                    <ProjectDot color={s.project_color} /> {s.project_name}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
