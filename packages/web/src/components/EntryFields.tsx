import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useProjects } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { Icon } from './Icon.tsx';
import { ProjectDot, ProjectLabel, ProjectPicker, TagPicker, projectColorStyle } from './Pickers.tsx';
import { suggestedDraft, useEntryFields, type EntryDraft, type Suggestion } from './useEntryFields.ts';

export interface EntryFieldsHandle {
  focus: () => void;
  hasFocus: () => boolean;
  hideSuggestions: () => void;
}

/**
 * The description with its suggestions, the project and task picker, the tag picker and the
 * billable toggle, editing `draft`. It knows nothing about a running entry: typing calls `onType`,
 * every other edit calls `onEdit` with the fields it changed, and the owner decides what to save.
 * Enter with no highlighted suggestion calls `onEnter`. `children` follow the attribute buttons in
 * the controls row. With `readOnly` the fields show `draft` and offer no edit.
 */
export const EntryFields = forwardRef<EntryFieldsHandle, {
  draft: EntryDraft;
  recentEntries: TimeEntry[];
  placeholder: string;
  onType: (description: string) => void;
  onEdit: (changes: Partial<EntryDraft>) => void;
  onDescriptionBlur: () => void;
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  readOnly?: boolean;
  children?: ReactNode;
}>(function EntryFields({ draft, recentEntries, placeholder, onType, onEdit, onDescriptionBlur, onEnter, readOnly = false, children }, ref) {
  const { data: projects = [] } = useProjects();
  const { suggestions, setShowSuggestions, highlight, setHighlight, project, projectChanges } = useEntryFields({ draft, recentEntries, projects });
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  // The description's blur hides the suggestions after a delay, so a click on one still lands.
  // A later focus cancels that pending hide, and a focus that comes from a closing picker does not
  // open the suggestions: the user did not ask for them.
  const hideSuggestionsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quietFocus = useRef(false);
  const focusDescriptionQuietly = () => {
    quietFocus.current = true;
    descriptionRef.current?.focus();
    quietFocus.current = false;
  };
  const projectButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => descriptionRef.current?.focus(),
    hasFocus: () => document.activeElement === descriptionRef.current,
    hideSuggestions: () => setShowSuggestions(false),
  }));

  const pickSuggestion = (s: Suggestion) => {
    setShowSuggestions(false);
    setHighlight(-1);
    onEdit(suggestedDraft(s));
  };

  return (
    <>
      <div className="timer-description">
        <input
          ref={descriptionRef}
          value={draft.description}
          placeholder={placeholder}
          aria-label="Description"
          maxLength={3000}
          readOnly={readOnly}
          onChange={(event) => {
            onType(event.target.value);
            setShowSuggestions(true);
            setHighlight(-1);
          }}
          onFocus={() => {
            clearTimeout(hideSuggestionsTimer.current);
            setShowSuggestions(!quietFocus.current && !readOnly);
          }}
          onBlur={() => {
            hideSuggestionsTimer.current = setTimeout(() => setShowSuggestions(false), 150);
            onDescriptionBlur();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (highlight >= 0 && suggestions[highlight]) {
                pickSuggestion(suggestions[highlight]!);
              } else {
                onEnter(event);
              }
            } else if (event.key === 'Escape') {
              setShowSuggestions(false);
            } else if (event.key === '@' && draft.description === '' && !readOnly) {
              event.preventDefault();
              setPicker('project');
            } else if (event.key === '#' && draft.description === '' && !readOnly) {
              event.preventDefault();
              setPicker('tags');
            }
          }}
        />
        {suggestions.length > 0 ? (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.key} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`suggestion${i === highlight ? ' highlighted' : ''}`}
                  onMouseDown={(event) => { event.preventDefault(); pickSuggestion(s); }}
                >
                  <span>{s.description || <em className="muted">(no description)</em>}</span>
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

      <div className="timer-controls">
        <button
          ref={projectButton}
          type="button"
          className={`icon-button timer-attr timer-project${project ? ' active' : ''}`}
          style={projectColorStyle(project?.color)}
          title="Project (@)"
          aria-label="Project"
          disabled={readOnly}
          onClick={() => setPicker('project')}
        >
          {project ? <ProjectLabel projectId={project.id} taskId={draft.task_id} /> : <Icon name="folder" />}
        </button>
        <button
          ref={tagButton}
          type="button"
          className={`icon-button timer-attr${draft.tags.length ? ' active' : ''}`}
          title={draft.tags.length ? draft.tags.join(', ') : 'Tags (#)'}
          aria-label="Tags"
          disabled={readOnly}
          onClick={() => setPicker('tags')}
        >
          <Icon name="tag" />
          {draft.tags.length ? <span className="badge">{draft.tags.length}</span> : null}
        </button>
        <button
          type="button"
          className={`icon-button timer-attr billable-toggle${draft.billable ? ' active billable' : ''}`}
          title="Billable"
          aria-label="Billable"
          aria-pressed={draft.billable}
          disabled={readOnly}
          onClick={() => onEdit({ billable: !draft.billable })}
        >
          <Icon name="dollar" />
        </button>
        {children}
      </div>

      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectButton.current}
          projectId={draft.project_id}
          taskId={draft.task_id}
          onChange={(pid, tid) => onEdit(projectChanges(pid, tid))}
          onClose={() => { setPicker(null); focusDescriptionQuietly(); }}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagButton.current}
          value={draft.tags}
          onChange={(tags) => onEdit({ tags })}
          onClose={() => { setPicker(null); focusDescriptionQuietly(); }}
        />
      ) : null}
    </>
  );
});
