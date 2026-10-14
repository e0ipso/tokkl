import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useBulkPatch, useCreateEntry, useDeleteEntry, usePreferences, useRestoreEntry, useSavePreferences, useUpdateEntry,
  type PatchOperation,
} from '../api/hooks.ts';
import type { Favorite, TimeEntry } from '../api/types.ts';
import { localDay } from '../lib/entryTime.ts';
import { dayLabel, duration, entrySeconds, formatTime, today, useNow, useSettings } from '../lib/settings.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { ProjectLabel, ProjectPicker, TagPicker } from './Pickers.tsx';
import { DurationField } from './TimeFields.tsx';
import { useToast } from './Toast.tsx';

interface Row {
  key: string;
  entries: TimeEntry[];
}

function similarityKey(entry: TimeEntry): string {
  return [entry.description, entry.project_id, entry.task_id, entry.billable, [...entry.tags].sort().join(',')].join('\u0000');
}

/** Ids of finished entries whose time range overlaps another entry. Toggl allows overlaps; we only flag them. */
function overlappingIds(entries: TimeEntry[]): Set<number> {
  const sorted = entries.filter((e) => e.stop).sort((a, b) => a.start.localeCompare(b.start));
  const ids = new Set<number>();
  let latest: TimeEntry | null = null;
  for (const entry of sorted) {
    if (latest && Date.parse(entry.start) < Date.parse(latest.stop!)) {
      ids.add(entry.id);
      ids.add(latest.id);
    }
    if (!latest || Date.parse(entry.stop!) > Date.parse(latest.stop!)) latest = entry;
  }
  return ids;
}

const entryCount = (count: number) => (count === 1 ? '1 entry' : `${count} entries`);

/**
 * Deletes each entry on its own, so one failure (say, an entry another device already deleted)
 * does not stop the rest. The toast counts what was deleted and what failed, and Undo restores
 * only the entries this call deleted.
 */
function useDeleteEntries() {
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const toast = useToast();
  return async (ids: number[]) => {
    const results = await Promise.allSettled(ids.map((id) => remove.mutateAsync(id)));
    const deleted = ids.filter((_, index) => results[index]!.status === 'fulfilled');
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    const undo = deleted.length ? { label: 'Undo', run: () => deleted.forEach((id) => restore.mutate(id)) } : undefined;
    if (!failure) {
      toast.show(ids.length > 1 ? `${ids.length} entries deleted` : 'Entry deleted', { action: undo });
      return;
    }
    const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    const failed = ids.length - deleted.length;
    const message = deleted.length
      ? `${entryCount(deleted.length)} deleted, ${entryCount(failed)} failed: ${reason}`
      : failed > 1 ? `${failed} entries failed: ${reason}` : reason;
    toast.show(message, { kind: 'error', action: undo });
  };
}

function rowsForDay(entries: TimeEntry[], collapse: boolean): Row[] {
  if (!collapse) return entries.map((entry) => ({ key: String(entry.id), entries: [entry] }));
  const rows = new Map<string, Row>();
  for (const entry of entries) {
    const key = similarityKey(entry);
    const row = rows.get(key);
    if (row) row.entries.push(entry);
    else rows.set(key, { key, entries: [entry] });
  }
  return [...rows.values()];
}

export function EntryList({ entries, onContinue }: { entries: TimeEntry[]; onContinue: (entry: TimeEntry) => void }) {
  const settings = useSettings();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const todayKey = today(settings.timeZone);
  const days = useMemo(() => {
    const byDay = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      if (!entry.stop) continue;
      const key = localDay(entry.start, settings.timeZone);
      byDay.set(key, [...(byDay.get(key) ?? []), entry]);
    }
    return [...byDay].sort(([a], [b]) => b.localeCompare(a));
  }, [entries, settings.timeZone]);

  const overlaps = useMemo(() => overlappingIds(entries), [entries]);

  const toggle = (ids: number[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  if (days.length === 0) {
    return <p className="empty-state">No time entries in this period. Start the timer or switch to manual mode to add one.</p>;
  }

  return (
    <div className="entry-list">
      {selected.size > 0 ? <BulkBar ids={[...selected]} onDone={() => setSelected(new Set())} /> : null}
      {days.map(([day, list]) => {
        const total = list.reduce((sum, entry) => sum + entrySeconds(entry, new Date()), 0);
        const dayIds = list.map((entry) => entry.id);
        const allSelected = dayIds.every((id) => selected.has(id));
        return (
          <section key={day} className="day-group">
            <header className="day-header">
              <label className="day-select" title="Select all entries of this day">
                <input type="checkbox" checked={allSelected} onChange={(event) => toggle(dayIds, event.target.checked)} />
              </label>
              <h3>{dayLabel(day, todayKey)}</h3>
              <span className="day-total">{duration(total, settings)}</span>
            </header>
            <ul className="entries">
              {rowsForDay(list, settings.collapseSimilar).map((row) => (
                <EntryRow key={row.key} row={row} selected={selected} overlaps={overlaps} onToggle={toggle} onContinue={onContinue} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({ row, selected, overlaps, onToggle, onContinue }: {
  row: Row;
  selected: Set<number>;
  overlaps: Set<number>;
  onToggle: (ids: number[], on: boolean) => void;
  onContinue: (entry: TimeEntry) => void;
}) {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);
  const entry = row.entries[0]!;
  const ids = row.entries.map((e) => e.id);
  const grouped = row.entries.length > 1;
  const total = row.entries.reduce((sum, e) => sum + entrySeconds(e, new Date()), 0);
  const first = row.entries[row.entries.length - 1]!;

  return (
    <li className={`entry-row-wrap${grouped ? ' grouped' : ''}`}>
      <EntryLine
        entries={row.entries}
        selected={ids.every((id) => selected.has(id))}
        onSelect={(on) => onToggle(ids, on)}
        seconds={total}
        overlap={row.entries.some((e) => overlaps.has(e.id))}
        timeRange={`${formatTime(first.start, settings)} – ${formatTime(entry.stop!, settings)}`}
        countBadge={grouped ? (
          <button type="button" className="count-badge" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} title="Show entries">
            {row.entries.length}
          </button>
        ) : null}
        onContinue={() => onContinue(entry)}
      />
      {grouped && expanded ? (
        <ul className="entries nested">
          {row.entries.map((member) => (
            <li key={member.id}>
              <EntryLine
                entries={[member]}
                selected={selected.has(member.id)}
                onSelect={(on) => onToggle([member.id], on)}
                seconds={entrySeconds(member, new Date())}
                overlap={overlaps.has(member.id)}
                timeRange={`${formatTime(member.start, settings)} – ${formatTime(member.stop!, settings)}`}
                onContinue={() => onContinue(member)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One line in the list. With several entries it edits all of them at once through the bulk API. */
function EntryLine({ entries, selected, onSelect, seconds, overlap, timeRange, countBadge, onContinue }: {
  entries: TimeEntry[];
  selected: boolean;
  onSelect: (on: boolean) => void;
  seconds: number;
  overlap: boolean;
  timeRange: string;
  countBadge?: React.ReactNode;
  onContinue: () => void;
}) {
  const settings = useSettings();
  const entry = entries[0]!;
  const single = entries.length === 1;
  const [description, setDescription] = useState(entry.description);
  useEffect(() => setDescription(entry.description), [entry.description]);
  const [picker, setPicker] = useState<'project' | 'tags' | 'menu' | null>(null);
  const [editing, setEditing] = useState(false);
  const projectRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const bulk = useBulkPatch();
  const update = useUpdateEntry();
  const create = useCreateEntry();
  const deleteEntries = useDeleteEntries();
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const toast = useToast();
  useNow(60_000);

  const patch = (operations: PatchOperation[]) => {
    bulk.mutate({ ids: entries.map((e) => e.id), operations }, {
      onSuccess: (result) => {
        if (result.failure.length) toast.show(result.failure[0]!.message, { kind: 'error' });
      },
      onError: toast.error,
    });
  };

  const commitDescription = () => {
    if (description !== entry.description) patch([{ op: 'replace', path: '/description', value: description }]);
  };

  const deleteAll = () => deleteEntries(entries.map((e) => e.id));

  const duplicate = async () => {
    try {
      await create.mutateAsync({
        description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags,
        billable: entry.billable, start: entry.start, stop: entry.stop,
      });
      toast.show('Entry duplicated');
    } catch (error) {
      toast.error(error);
    }
  };

  const pin = () => {
    const favorite: Favorite = {
      description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags, billable: entry.billable,
    };
    const favorites = prefs?.favorites ?? [];
    if (favorites.length >= 9) return toast.show('You can pin up to 9 favorites', { kind: 'error' });
    savePrefs.mutate({ favorites: [...favorites, favorite] });
    toast.show('Pinned to favorites');
  };

  return (
    <div className={`entry-line${selected ? ' selected' : ''}`}>
      <input type="checkbox" className="entry-select" aria-label="Select entry" checked={selected} onChange={(event) => onSelect(event.target.checked)} />
      {countBadge}
      <input
        className="entry-description"
        value={description}
        placeholder="Add description"
        aria-label="Description"
        onChange={(event) => setDescription(event.target.value)}
        onBlur={commitDescription}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
      />
      <button ref={projectRef} type="button" className="entry-project" onClick={() => setPicker('project')}>
        {entry.project_id ? (
          <ProjectLabel projectId={entry.project_id} taskId={entry.task_id} fallback={{ name: entry.project_name, color: entry.project_color, client: entry.client_name, task: entry.task_name }} />
        ) : <span className="add-project"><Icon name="folder" size={14} /> Project</span>}
      </button>
      <button ref={tagRef} type="button" className={`entry-tags${entry.tags.length ? ' has-tags' : ''}`} onClick={() => setPicker('tags')} title="Tags">
        {entry.tags.length ? entry.tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>) : <Icon name="tag" size={14} />}
      </button>
      <button
        type="button"
        className={`icon-button entry-billable${entry.billable ? ' active billable' : ''}`}
        aria-pressed={entry.billable}
        aria-label="Billable"
        title="Billable"
        onClick={() => patch([{ op: 'replace', path: '/billable', value: !entry.billable }])}
      >
        <Icon name="dollar" size={16} />
      </button>
      <button type="button" className="entry-times" onClick={() => single ? setEditing(true) : undefined} disabled={!single} title={single ? 'Edit times' : undefined}>
        {overlap ? <span className="overlap-mark" title="Overlaps another entry" aria-label="Overlaps another entry">!</span> : null}
        {timeRange}
      </button>
      {single ? (
        <DurationField
          className="entry-duration"
          seconds={seconds}
          format={settings.durationFormat}
          onCommit={(next) => update.mutate({ id: entry.id, duration: next }, { onError: toast.error })}
        />
      ) : <span className="entry-duration">{duration(seconds, settings)}</span>}
      <button type="button" className="icon-button entry-continue" onClick={onContinue} title="Continue this entry" aria-label="Continue this entry">
        <Icon name="play" size={16} />
      </button>
      <button ref={menuRef} type="button" className="icon-button" onClick={() => setPicker('menu')} aria-label="More actions">
        <Icon name="more" />
      </button>

      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef.current}
          projectId={entry.project_id}
          taskId={entry.task_id}
          onChange={(pid, tid) => patch([
            { op: 'replace', path: '/project_id', value: pid },
            { op: 'replace', path: '/task_id', value: tid },
          ])}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef.current}
          value={entry.tags}
          onChange={(tags) => patch([{ op: 'replace', path: '/tags', value: tags }])}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'menu' ? (
        <Popover anchor={menuRef.current} onClose={() => setPicker(null)} width={200} align="right">
          <div className="menu">
            {single ? <button type="button" onClick={() => { setPicker(null); setEditing(true); }}><Icon name="edit" size={16} /> Edit</button> : null}
            {single ? <button type="button" onClick={() => { setPicker(null); void duplicate(); }}><Icon name="copy" size={16} /> Duplicate</button> : null}
            <button type="button" onClick={() => { setPicker(null); pin(); }}><Icon name="star" size={16} /> Pin as favorite</button>
            <button type="button" className="danger" onClick={() => { setPicker(null); void deleteAll(); }}>
              <Icon name="trash" size={16} /> Delete{entries.length > 1 ? ` ${entries.length} entries` : ''}
            </button>
          </div>
        </Popover>
      ) : null}
      {editing ? <EntryEditor entry={entry} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

function BulkBar({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const bulk = useBulkPatch();
  const deleteEntries = useDeleteEntries();
  const toast = useToast();

  const patch = (operations: PatchOperation[], message: string) => {
    bulk.mutate({ ids, operations }, {
      onSuccess: (result) => {
        toast.show(result.failure.length ? `${result.failure.length} entries failed: ${result.failure[0]!.message}` : message,
          { kind: result.failure.length ? 'error' : 'info' });
        onDone();
      },
      onError: toast.error,
    });
  };

  const deleteAll = async () => {
    await deleteEntries(ids);
    onDone();
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <button ref={projectRef} type="button" className="button button-ghost" onClick={() => setPicker('project')}>
        <Icon name="folder" size={16} /> Project
      </button>
      <button ref={tagRef} type="button" className="button button-ghost" onClick={() => setPicker('tags')}>
        <Icon name="tag" size={16} /> Add tags
      </button>
      <button type="button" className="button button-ghost" onClick={() => patch([{ op: 'replace', path: '/billable', value: true }], 'Marked billable')}>
        Billable
      </button>
      <button type="button" className="button button-ghost" onClick={() => patch([{ op: 'replace', path: '/billable', value: false }], 'Marked non-billable')}>
        Non-billable
      </button>
      <button type="button" className="button button-danger-ghost" onClick={() => void deleteAll()}>
        <Icon name="trash" size={16} /> Delete
      </button>
      <span className="spacer" />
      <button type="button" className="button button-ghost" onClick={onDone}>Clear</button>
      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectRef.current}
          projectId={null}
          taskId={null}
          onChange={(pid, tid) => patch([
            { op: 'replace', path: '/project_id', value: pid },
            { op: 'replace', path: '/task_id', value: tid },
          ], 'Project updated')}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagRef.current}
          value={[]}
          onChange={(tags) => { setPicker(null); patch([{ op: 'add', path: '/tags', value: tags }], 'Tags added'); }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
