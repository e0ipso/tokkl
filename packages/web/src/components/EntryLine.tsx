import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { usePreferences, useSavePreferences } from '../api/account.ts';
import { useCreateEntry, useUpdateEntry } from '../api/entries.ts';
import { useSettings } from '../api/settings.ts';
import type { PatchOperation } from '@tokkl/types';
import { duplicateInput } from '../lib/duplicateEntry.ts';
import { MAX_FAVORITES, entryPatch, withFavorite } from '../lib/entryPatches.ts';
import type { NonEmpty, StoppedEntry } from '../lib/entryRows.ts';
import { duration } from '../lib/format.ts';
import { DurationField } from './DurationField.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { EntryLineMenu } from './EntryLineMenu.tsx';
import { ProjectLabel, projectColorStyle } from './ProjectLabel.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TagPicker } from './TagPicker.tsx';
import { useToast } from './Toast.tsx';
import { draftOf } from './useEntryFields.ts';
import { useBulkEdit, useDeleteEntries } from './useEntryListActions.ts';
import { t } from '../i18n/messages.ts';

/** One line in the list. With several entries it edits all of them at once through the bulk API. */
export function EntryLine({
  entries,
  selected,
  onSelect,
  seconds,
  overlap,
  timeRange,
  countBadge,
  onContinue,
}: {
  entries: NonEmpty<StoppedEntry>;
  selected: boolean;
  onSelect: (on: boolean) => void;
  seconds: number;
  overlap: boolean;
  timeRange: string;
  countBadge?: ReactNode;
  onContinue: () => void;
}) {
  const settings = useSettings();
  const [entry] = entries;
  const single = entries.length === 1;
  const { description, setDescription, input } = useRowDescription(entry.description);
  const [picker, setPicker] = useState<'project' | 'tags' | 'menu' | null>(null);
  const [editing, setEditing] = useState(false);
  const projectRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const bulkEdit = useBulkEdit();
  const update = useUpdateEntry();
  const create = useCreateEntry();
  const deleteEntries = useDeleteEntries();
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const toast = useToast();

  const patch = (operations: PatchOperation[]) =>
    void bulkEdit(
      entries.map(e => e.id),
      operations,
    );

  const commitDescription = () => {
    if (description !== entry.description) patch(entryPatch.description(description));
  };

  const duplicate = async () => {
    try {
      await create.mutateAsync(duplicateInput(entry, settings.timeZone));
      toast.show(t('entries.duplicated'));
    } catch (error) {
      toast.error(error);
    }
  };

  const pin = () => {
    const favorites = withFavorite(prefs?.favorites ?? [], draftOf(entry));
    if (!favorites) {
      toast.show(t('entries.favoritesFull', { max: MAX_FAVORITES }), { kind: 'error' });
      return;
    }
    // The favorite shows at once; the toast waits for the server, and a failed save rolls it back.
    savePrefs.mutate({ favorites }, { onSuccess: () => toast.show(t('entries.pinned')), onError: toast.error });
  };

  return (
    <div className={`entry-line${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        className="entry-select"
        aria-label={t('entries.selectEntry')}
        checked={selected}
        onChange={event => onSelect(event.target.checked)}
      />
      {countBadge}
      <input
        ref={input}
        className="entry-description"
        value={description}
        placeholder={t('entries.addDescription')}
        aria-label={t('entries.description')}
        onChange={event => setDescription(event.target.value)}
        onBlur={commitDescription}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <button
        ref={projectRef}
        type="button"
        className={`entry-project${entry.project_id ? ' has-project' : ''}`}
        style={projectColorStyle(entry.project_id ? entry.project_color : null)}
        onClick={() => setPicker('project')}
      >
        {entry.project_id ? (
          <ProjectLabel
            projectId={entry.project_id}
            taskId={entry.task_id}
            fallback={{
              name: entry.project_name,
              color: entry.project_color,
              client: entry.client_name,
              task: entry.task_name,
            }}
          />
        ) : (
          <span className="add-project">
            <Icon name="folder" size={14} /> {t('entries.project')}
          </span>
        )}
      </button>
      <button
        ref={tagRef}
        type="button"
        className={`entry-tags${entry.tags.length ? ' has-tags' : ''}`}
        onClick={() => setPicker('tags')}
        title={t('entries.tags')}
      >
        {entry.tags.length ? (
          entry.tags.map(tag => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))
        ) : (
          <Icon name="tag" size={14} />
        )}
      </button>
      <button
        type="button"
        className={`icon-button entry-billable billable-toggle${entry.billable ? ' active billable' : ''}`}
        aria-pressed={entry.billable}
        aria-label={t('entries.billable')}
        title={t('entries.billable')}
        onClick={() => patch(entryPatch.billable(!entry.billable))}
      >
        <Icon name="dollar" size={16} />
      </button>
      <button
        type="button"
        className="entry-times"
        onClick={() => (single ? setEditing(true) : undefined)}
        disabled={!single}
        title={single ? t('entries.editTimes') : undefined}
        aria-label={single && !timeRange ? t('entries.editTimes') : undefined}
      >
        {overlap ? (
          <span className="overlap-mark" title={t('entries.overlaps')} aria-label={t('entries.overlaps')}>
            !
          </span>
        ) : null}
        {timeRange}
      </button>
      {single ? (
        <DurationField
          className="entry-duration"
          seconds={seconds}
          format={settings.durationFormat}
          onCommit={next => update.mutate({ id: entry.id, duration: next }, { onError: toast.error })}
        />
      ) : (
        <span className="entry-duration">{duration(seconds, settings)}</span>
      )}
      <button
        type="button"
        className="icon-button entry-continue"
        onClick={onContinue}
        title={t('entries.continue')}
        aria-label={t('entries.continue')}
      >
        <Icon name="play" size={16} />
      </button>
      <button
        ref={menuRef}
        type="button"
        className="icon-button"
        onClick={() => setPicker('menu')}
        aria-label={t('entries.moreActions')}
      >
        <Icon name="more" />
      </button>

      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef}
          projectId={entry.project_id}
          taskId={entry.task_id}
          onChange={(pid, tid) => patch(entryPatch.project(pid, tid))}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef}
          value={entry.tags}
          onChange={tags => patch(entryPatch.tags(tags))}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'menu' ? (
        <EntryLineMenu
          anchor={menuRef}
          count={entries.length}
          onClose={() => setPicker(null)}
          onEdit={() => setEditing(true)}
          onDuplicate={() => void duplicate()}
          onPin={pin}
          onDelete={() => void deleteEntries(entries.map(e => e.id))}
        />
      ) : null}
      {editing ? <EntryEditor entry={entry} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/**
 * The description of a row. It follows the stored description, unless the user is typing a change
 * of their own: a refresh must not throw that away. Committing it then saves the typed text.
 */
function useRowDescription(stored: string) {
  const [description, setDescription] = useState(stored);
  const input = useRef<HTMLInputElement>(null);
  const lastStored = useRef(stored);
  const follow = useEffectEvent((next: string) => {
    const typing = document.activeElement === input.current && description !== lastStored.current;
    lastStored.current = next;
    if (!typing) setDescription(next);
  });
  useEffect(() => follow(stored), [stored]);
  return { description, setDescription, input };
}
