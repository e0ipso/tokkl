import { useMemo, useState } from 'react';
import { useSettings } from '../api/settings.ts';
import type { TimeEntry } from '../api/types.ts';
import { overlappingIds } from '../lib/entryOverlap.ts';
import {
  entriesByDay,
  presentSelection,
  rangeLabel,
  rowsForDay,
  stoppedSeconds,
  totalSeconds,
  type EntryRowGroup,
} from '../lib/entryRows.ts';
import { dayLabel, duration, formatTime, today } from '../lib/format.ts';
import { BulkBar } from './BulkBar.tsx';
import { EmptyState } from './EmptyState.tsx';
import { EntryLine } from './EntryLine.tsx';
import { Icon } from './Icon.tsx';

type Toggle = (ids: number[], on: boolean) => void;

function EmptyList({ onStartTimer, onManualMode }: { onStartTimer: () => void; onManualMode?: () => void }) {
  return (
    <EmptyState
      icon={<Icon name="timer" size={32} />}
      title="No time entries in this period"
      actions={
        <>
          <button type="button" className="button button-primary" onClick={onStartTimer}>
            <Icon name="play" size={14} /> Start timer
          </button>
          {onManualMode ? (
            <button type="button" className="button button-ghost" onClick={onManualMode}>
              <Icon name="list" size={14} /> Manual mode
            </button>
          ) : null}
        </>
      }
    >
      {onManualMode
        ? 'Start the timer when you paddle out, or switch to manual mode to log time you already worked.'
        : 'Start the timer when you paddle out, or fill in the times above to log time you already worked.'}
    </EmptyState>
  );
}

/** The stopped entries of the shown range, by day, with selection for the bulk bar. */
export function EntryList({
  entries,
  onContinue,
  onStartTimer,
  onManualMode,
}: {
  entries: TimeEntry[];
  onContinue: (entry: TimeEntry) => void;
  /** Actions for the empty list. Manual mode is left out when it is already on. */
  onStartTimer: () => void;
  onManualMode?: () => void;
}) {
  const settings = useSettings();
  // Ids the user checked. Entries can go away while checked (deleted elsewhere, or out of the
  // range), so everything below reads `selected`, the checked ids still on the list.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const todayKey = today(settings.timeZone);
  const days = useMemo(() => entriesByDay(entries, settings.timeZone), [entries, settings.timeZone]);
  const overlaps = useMemo(() => overlappingIds(entries), [entries]);
  const selected = useMemo(
    () =>
      presentSelection(
        checked,
        days.flatMap(({ entries: list }) => list),
      ),
    [checked, days],
  );

  const toggle: Toggle = (ids, on) => {
    setChecked(current => {
      const next = presentSelection(current, entries);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  if (days.length === 0) return <EmptyList onStartTimer={onStartTimer} onManualMode={onManualMode} />;

  return (
    <div className="entry-list">
      {selected.size > 0 ? <BulkBar ids={[...selected]} onDone={() => setChecked(new Set())} /> : null}
      {days.map(({ day, entries: list }) => {
        const dayIds = list.map(entry => entry.id);
        const allSelected = dayIds.every(id => selected.has(id));
        return (
          <section key={day} className="day-group">
            <header className="day-header">
              <label className="day-select" title="Select all entries of this day">
                <input type="checkbox" checked={allSelected} onChange={event => toggle(dayIds, event.target.checked)} />
              </label>
              <h3>{dayLabel(day, todayKey)}</h3>
              <span className="day-total">{duration(totalSeconds(list), settings)}</span>
            </header>
            <ul className="entries">
              {rowsForDay(list, settings.collapseSimilar).map(row => (
                <EntryRow
                  key={row.key}
                  row={row}
                  selected={selected}
                  overlaps={overlaps}
                  onToggle={toggle}
                  onContinue={onContinue}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({
  row,
  selected,
  overlaps,
  onToggle,
  onContinue,
}: {
  row: EntryRowGroup;
  selected: ReadonlySet<number>;
  overlaps: ReadonlySet<number>;
  onToggle: Toggle;
  onContinue: (entry: TimeEntry) => void;
}) {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [entry] = row.entries;
  const ids = row.entries.map(e => e.id);
  const grouped = row.entries.length > 1;
  const format = (iso: string) => formatTime(iso, settings);

  return (
    <li className={`entry-row-wrap${grouped ? ' grouped' : ''}`}>
      <EntryLine
        entries={row.entries}
        selected={ids.every(id => selected.has(id))}
        onSelect={on => onToggle(ids, on)}
        seconds={totalSeconds(row.entries)}
        overlap={row.entries.some(e => overlaps.has(e.id))}
        timeRange={rangeLabel(row.entries, format)}
        countBadge={
          grouped ? (
            <button
              type="button"
              className="count-badge"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              title="Show entries"
            >
              {row.entries.length}
            </button>
          ) : null
        }
        onContinue={() => onContinue(entry)}
      />
      {grouped && expanded ? (
        <ul className="entries nested">
          {row.entries.map(member => (
            <li key={member.id}>
              <EntryLine
                entries={[member]}
                selected={selected.has(member.id)}
                onSelect={on => onToggle([member.id], on)}
                seconds={stoppedSeconds(member)}
                overlap={overlaps.has(member.id)}
                timeRange={rangeLabel([member], format)}
                onContinue={() => onContinue(member)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
