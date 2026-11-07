import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { usePreferences, useSavePreferences } from '../api/account.ts';
import { useCreateEntry, useUpdateEntry } from '../api/entries.ts';
import { useSettings } from '../api/settings.ts';
import type { PatchOperation } from '../api/types.ts';
import { duplicateInput } from '../lib/duplicateEntry.ts';
import type { StoppedEntry } from '../lib/entryRows.ts';
import { duration } from '../lib/format.ts';
import { DurationField } from './DurationField.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { ProjectLabel, ProjectPicker, TagPicker, projectColorStyle } from './Pickers.tsx';
import { useToast } from './Toast.tsx';
import { draftOf } from './useEntryFields.ts';
import { useBulkEdit, useDeleteEntries } from './useEntryListActions.ts';

/** Favorites the timer page can show, each with its number key. */
const MAX_FAVORITES = 9;

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
  entries: StoppedEntry[];
  selected: boolean;
  onSelect: (on: boolean) => void;
  seconds: number;
  overlap: boolean;
  timeRange: string;
  countBadge?: ReactNode;
  onContinue: () => void;
}) {
  const settings = useSettings();
  const entry = entries[0]!;
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
    bulkEdit(
      entries.map(e => e.id),
      operations,
    );

  const commitDescription = () => {
    if (description !== entry.description) patch([{ op: 'replace', path: '/description', value: description }]);
  };

  const duplicate = async () => {
    try {
      await create.mutateAsync(duplicateInput(entry, settings.timeZone));
      toast.show('Entry duplicated');
    } catch (error) {
      toast.error(error);
    }
  };

  const pin = () => {
    const favorites = prefs?.favorites ?? [];
    if (favorites.length >= MAX_FAVORITES) {
      toast.show(`You can pin up to ${MAX_FAVORITES} favorites`, { kind: 'error' });
      return;
    }
    // The favorite shows at once; the toast waits for the server, and a failed save rolls it back.
    savePrefs.mutate(
      { favorites: [...favorites, draftOf(entry)] },
      { onSuccess: () => toast.show('Pinned to favorites'), onError: toast.error },
    );
  };

  /** Closes the menu, then runs the item. */
  const fromMenu = (action: () => void) => () => {
    setPicker(null);
    action();
  };

  return (
    <div className={`entry-line${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        className="entry-select"
        aria-label="Select entry"
        checked={selected}
        onChange={event => onSelect(event.target.checked)}
      />
      {countBadge}
      <input
        ref={input}
        className="entry-description"
        value={description}
        placeholder="Add description"
        aria-label="Description"
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
            <Icon name="folder" size={14} /> Project
          </span>
        )}
      </button>
      <button
        ref={tagRef}
        type="button"
        className={`entry-tags${entry.tags.length ? ' has-tags' : ''}`}
        onClick={() => setPicker('tags')}
        title="Tags"
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
        aria-label="Billable"
        title="Billable"
        onClick={() => patch([{ op: 'replace', path: '/billable', value: !entry.billable }])}
      >
        <Icon name="dollar" size={16} />
      </button>
      <button
        type="button"
        className="entry-times"
        onClick={() => (single ? setEditing(true) : undefined)}
        disabled={!single}
        title={single ? 'Edit times' : undefined}
        aria-label={single && !timeRange ? 'Edit times' : undefined}
      >
        {overlap ? (
          <span className="overlap-mark" title="Overlaps another entry" aria-label="Overlaps another entry">
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
        title="Continue this entry"
        aria-label="Continue this entry"
      >
        <Icon name="play" size={16} />
      </button>
      <button
        ref={menuRef}
        type="button"
        className="icon-button"
        onClick={() => setPicker('menu')}
        aria-label="More actions"
      >
        <Icon name="more" />
      </button>

      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef}
          projectId={entry.project_id}
          taskId={entry.task_id}
          onChange={(pid, tid) =>
            patch([
              { op: 'replace', path: '/project_id', value: pid },
              { op: 'replace', path: '/task_id', value: tid },
            ])
          }
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef}
          value={entry.tags}
          onChange={tags => patch([{ op: 'replace', path: '/tags', value: tags }])}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'menu' ? (
        <Popover anchor={menuRef} label="Entry actions" onClose={() => setPicker(null)} width={200} align="right">
          <div className="menu">
            {single ? (
              <button type="button" onClick={fromMenu(() => setEditing(true))}>
                <Icon name="edit" size={16} /> Edit
              </button>
            ) : null}
            {single ? (
              <button type="button" onClick={fromMenu(() => void duplicate())}>
                <Icon name="copy" size={16} /> Duplicate
              </button>
            ) : null}
            <button type="button" onClick={fromMenu(pin)}>
              <Icon name="star" size={16} /> Pin as favorite
            </button>
            <button
              type="button"
              className="danger"
              onClick={fromMenu(() => void deleteEntries(entries.map(e => e.id)))}
            >
              <Icon name="trash" size={16} /> Delete{entries.length > 1 ? ` ${entries.length} entries` : ''}
            </button>
          </div>
        </Popover>
      ) : null}
      {editing ? <EntryEditor entry={entry} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
