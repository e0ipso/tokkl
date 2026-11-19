import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useProjects } from '../api/projects.ts';
import type { TimeEntry } from '@tokkl/types';
import { DescriptionCombobox, type DescriptionComboboxHandle } from './DescriptionCombobox.tsx';
import { Icon } from './Icon.tsx';
import { ProjectLabel, projectColorStyle } from './ProjectLabel.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { suggestedDraft, useEntryFields, type EntryDraft } from './useEntryFields.ts';
import { t } from '../i18n/messages.ts';

export interface EntryFieldsHandle {
  focus: () => void;
  hasFocus: () => boolean;
  hideSuggestions: () => void;
}

/**
 * Knows nothing about a running entry: typing calls `onType`, other edits `onEdit`, and the owner saves.
 * `readOnly` shows `draft` without edits.
 */
export const EntryFields = forwardRef<
  EntryFieldsHandle,
  {
    draft: EntryDraft;
    recentEntries: TimeEntry[];
    placeholder: string;
    onType: (description: string) => void;
    onEdit: (changes: Partial<EntryDraft>) => void;
    onDescriptionBlur: () => void;
    onEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
    readOnly?: boolean;
    children?: ReactNode;
  }
>(function EntryFields(
  { draft, recentEntries, placeholder, onType, onEdit, onDescriptionBlur, onEnter, readOnly = false, children },
  ref,
) {
  const { data: projects = [] } = useProjects();
  const { project, projectChanges } = useEntryFields({ draft, projects });
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const combo = useRef<DescriptionComboboxHandle>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => combo.current?.focus(),
    hasFocus: () => combo.current?.hasFocus() ?? false,
    hideSuggestions: () => combo.current?.hideSuggestions(),
  }));

  // `@` and `#` in an empty description open the project and tag pickers.
  const onPickerKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (draft.description !== '' || readOnly) return;
    if (event.key === '@' || event.key === '#') {
      event.preventDefault();
      setPicker(event.key === '@' ? 'project' : 'tags');
    }
  };
  // Closing a picker hands focus back without opening the suggestions.
  const closePicker = () => {
    setPicker(null);
    combo.current?.focusQuietly();
  };

  return (
    <>
      <DescriptionCombobox
        ref={combo}
        className="timer-description"
        value={draft.description}
        recentEntries={recentEntries}
        placeholder={placeholder}
        readOnly={readOnly}
        onType={onType}
        onPick={s => onEdit(suggestedDraft(s))}
        onBlur={onDescriptionBlur}
        onEnter={onEnter}
        onExtraKeyDown={onPickerKey}
      />

      <div className="timer-controls">
        <button
          ref={projectButton}
          type="button"
          className={`icon-button timer-attr timer-project${project ? ' active' : ''}`}
          style={projectColorStyle(project?.color)}
          title={t('entries.projectTitle')}
          aria-label={t('entries.project')}
          disabled={readOnly}
          onClick={() => setPicker('project')}
        >
          {project ? <ProjectLabel projectId={project.id} taskId={draft.task_id} /> : <Icon name="folder" />}
        </button>
        <button
          ref={tagButton}
          type="button"
          className={`icon-button timer-attr${draft.tags.length ? ' active' : ''}`}
          title={draft.tags.length ? draft.tags.join(', ') : t('entries.tagsTitle')}
          aria-label={t('entries.tags')}
          disabled={readOnly}
          onClick={() => setPicker('tags')}
        >
          <Icon name="tag" />
          {draft.tags.length ? <span className="badge">{draft.tags.length}</span> : null}
        </button>
        <button
          type="button"
          className={`icon-button timer-attr billable-toggle${draft.billable ? ' active billable' : ''}`}
          title={t('entries.billable')}
          aria-label={t('entries.billable')}
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
          anchor={projectButton}
          projectId={draft.project_id}
          taskId={draft.task_id}
          onChange={(pid, tid) => onEdit(projectChanges(pid, tid))}
          onClose={closePicker}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker anchor={tagButton} value={draft.tags} onChange={tags => onEdit({ tags })} onClose={closePicker} />
      ) : null}
    </>
  );
});
