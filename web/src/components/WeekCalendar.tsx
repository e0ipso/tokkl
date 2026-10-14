import { useEffect, useMemo, useRef, useState } from 'react';
import { useCreateEntry, useEntries, useUpdateEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { addDays, clockSpanOnDay, startOfWeek } from '../../../shared/time.ts';
import { instantAt, localDay } from '../lib/entryTime.ts';
import { dayLabel, duration, shortDate, entrySeconds, formatTime, minutesOfDay, today, useNow, useSettings } from '../lib/settings.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';

const HOUR_HEIGHT = 48;
const SNAP_MINUTES = 15;
const MIN_BLOCK_MINUTES = 15;

type Drag =
  | { kind: 'create'; day: string; fromMinute: number; toMinute: number }
  | { kind: 'move' | 'resize'; entry: TimeEntry; day: string; originY: number; startMinute: number; endMinute: number; deltaMinutes: number };

function snap(minutes: number): number {
  return Math.max(0, Math.min(24 * 60, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));
}

interface Block {
  entry: TimeEntry;
  day: string;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
}

/** Lays out the part of each entry that falls on each day, side by side where they overlap. */
function layout(entries: TimeEntry[], days: string[], timeZone: string, now: Date): Block[] {
  const blocks: Block[] = [];
  for (const day of days) {
    const onDay = entries
      .map((entry) => {
        const span = clockSpanOnDay(new Date(entry.start), entry.stop ? new Date(entry.stop) : now, day, timeZone);
        if (!span) return null;
        return { entry, day, top: span.top, bottom: Math.max(span.bottom, span.top + 5), lane: 0, lanes: 1 };
      })
      .filter((block): block is Block => block !== null)
      .sort((a, b) => a.top - b.top);
    let cluster: Block[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
      for (const block of cluster) block.lanes = lanes;
      cluster = [];
    };
    for (const block of onDay) {
      if (block.top >= clusterEnd) {
        flush();
        clusterEnd = -1;
      }
      const used = new Set(cluster.filter((b) => b.bottom > block.top).map((b) => b.lane));
      let lane = 0;
      while (used.has(lane)) lane++;
      block.lane = lane;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.bottom);
    }
    flush();
    blocks.push(...onDay);
  }
  return blocks;
}

export function WeekCalendar() {
  const settings = useSettings();
  const now = useNow(60_000);
  const todayKey = today(settings.timeZone);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey, settings.beginningOfWeek));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const { data: entries = [] } = useEntries(addDays(weekStart, -1), addDays(weekStart, 7));
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const toast = useToast();
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => layout(entries, days, settings.timeZone, now), [entries, days, settings.timeZone, now]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || document.querySelector('.modal, .popover')) return;
      if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey) {
        setWeekStart(startOfWeek(todayKey, settings.beginningOfWeek));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [todayKey, settings.beginningOfWeek]);

  const minuteAt = (clientY: number, column: HTMLElement) =>
    ((clientY - column.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;

  const finishDrag = async () => {
    const current = drag;
    setDrag(null);
    if (!current) return;
    try {
      if (current.kind === 'create') {
        // A plain click (no drag) does nothing; creating needs a dragged range.
        if (current.toMinute === current.fromMinute) return;
        const from = Math.min(Math.min(current.fromMinute, current.toMinute), 24 * 60 - MIN_BLOCK_MINUTES);
        const to = Math.max(current.fromMinute, current.toMinute, from + MIN_BLOCK_MINUTES);
        const created = await create.mutateAsync({
          start: instantAt(current.day, from, settings.timeZone).toISOString(),
          stop: instantAt(current.day, Math.min(to, 24 * 60 - 1), settings.timeZone).toISOString(),
        });
        setEditing(created);
        return;
      }
      if (current.deltaMinutes === 0) {
        setEditing(current.entry);
        return;
      }
      const start = new Date(current.entry.start);
      if (current.kind === 'move') {
        const shift = current.deltaMinutes * 60_000;
        await update.mutateAsync({
          id: current.entry.id,
          start: new Date(start.getTime() + shift).toISOString(),
          ...(current.entry.stop ? { stop: new Date(Date.parse(current.entry.stop) + shift).toISOString() } : {}),
        });
      } else if (current.entry.stop) {
        const stop = Math.max(start.getTime() + MIN_BLOCK_MINUTES * 60_000, Date.parse(current.entry.stop) + current.deltaMinutes * 60_000);
        await update.mutateAsync({ id: current.entry.id, stop: new Date(stop).toISOString() });
      }
    } catch (error) {
      toast.error(error);
    }
  };

  const shiftWeek = (weeks: number) => setWeekStart(addDays(weekStart, weeks * 7));
  const weekTotal = entries
    .filter((entry) => { const day = localDay(entry.start, settings.timeZone); return day >= weekStart && day <= days[6]!; })
    .reduce((sum, entry) => sum + entrySeconds(entry, now), 0);
  const nowMinute = minutesOfDay(now, settings.timeZone);

  return (
    <div className="calendar" onPointerUp={() => void finishDrag()} onPointerLeave={() => drag && void finishDrag()}>
      <div className="calendar-toolbar">
        <button type="button" className="icon-button" aria-label="Previous week" onClick={() => shiftWeek(-1)}><Icon name="chevronLeft" /></button>
        <button type="button" className="button button-ghost" onClick={() => setWeekStart(startOfWeek(todayKey, settings.beginningOfWeek))} title="This week (T)">
          This week
        </button>
        <button type="button" className="icon-button" aria-label="Next week" onClick={() => shiftWeek(1)}><Icon name="chevronRight" /></button>
        <span className="calendar-range">{shortDate(days[0]!)} to {shortDate(days[6]!)}</span>
        <span className="spacer" />
        <span className="muted">Week total <strong>{duration(weekTotal, settings)}</strong></span>
      </div>
      <div className="calendar-head">
        <div className="calendar-gutter" />
        {days.map((day) => {
          const total = entries
            .filter((entry) => localDay(entry.start, settings.timeZone) === day)
            .reduce((sum, entry) => sum + entrySeconds(entry, now), 0);
          return (
            <div key={day} className={`calendar-day-head${day === todayKey ? ' today' : ''}`}>
              <span>{dayLabel(day, todayKey)}</span>
              <small>{duration(total, settings)}</small>
            </div>
          );
        })}
      </div>
      <div className="calendar-body" ref={scroller}>
        <div className="calendar-grid" style={{ height: 24 * HOUR_HEIGHT }}>
          <div className="calendar-gutter">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                {formatTime(instantAt(todayKey, hour * 60, settings.timeZone), settings)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day}
              className={`calendar-column${day === todayKey ? ' today' : ''}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as HTMLElement).closest('.calendar-block')) return;
                const minute = snap(minuteAt(event.clientY, event.currentTarget));
                setDrag({ kind: 'create', day, fromMinute: minute, toMinute: minute });
              }}
              onPointerMove={(event) => {
                if (!drag) return;
                if (drag.kind === 'create' && drag.day === day) {
                  setDrag({ ...drag, toMinute: snap(minuteAt(event.clientY, event.currentTarget)) });
                } else if (drag.kind !== 'create') {
                  const delta = Math.round(((event.clientY - drag.originY) / HOUR_HEIGHT) * 60 / SNAP_MINUTES) * SNAP_MINUTES;
                  if (delta !== drag.deltaMinutes) setDrag({ ...drag, deltaMinutes: delta });
                }
              }}
            >
              {day === todayKey ? <div className="calendar-now" style={{ top: (nowMinute / 60) * HOUR_HEIGHT }} /> : null}
              {blocks.filter((block) => block.day === day).map((block) => {
                const active = drag && drag.kind !== 'create' && drag.entry.id === block.entry.id;
                let top = block.top;
                let bottom = block.bottom;
                if (active && drag.kind === 'move') {
                  top += drag.deltaMinutes;
                  bottom += drag.deltaMinutes;
                } else if (active && drag.kind === 'resize') {
                  bottom = Math.max(top + MIN_BLOCK_MINUTES, bottom + drag.deltaMinutes);
                }
                const color = block.entry.project_color ?? 'var(--muted)';
                const width = 100 / block.lanes;
                return (
                  <div
                    key={`${block.entry.id}-${day}`}
                    className={`calendar-block${block.entry.stop ? '' : ' running'}${active ? ' dragging' : ''}`}
                    style={{
                      top: (top / 60) * HOUR_HEIGHT,
                      height: Math.max(((bottom - top) / 60) * HOUR_HEIGHT, 6),
                      left: `calc(${block.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      borderLeftColor: color,
                      ['--block-color' as string]: color,
                    }}
                    title={`${block.entry.description || '(no description)'}\n${formatTime(block.entry.start, settings)} – ${block.entry.stop ? formatTime(block.entry.stop, settings) : 'now'}`}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      const resize = (event.target as HTMLElement).classList.contains('calendar-resize');
                      setDrag({
                        kind: resize ? 'resize' : 'move', entry: block.entry, day, originY: event.clientY,
                        startMinute: block.top, endMinute: block.bottom, deltaMinutes: 0,
                      });
                    }}
                  >
                    <strong>{block.entry.description || block.entry.project_name || '(no description)'}</strong>
                    {bottom - top >= 45 ? (
                      <span>{[block.entry.project_name, duration(entrySeconds(block.entry, now), settings)].filter(Boolean).join(' · ')}</span>
                    ) : null}
                    {block.entry.stop ? <span className="calendar-resize" aria-hidden /> : null}
                  </div>
                );
              })}
              {drag?.kind === 'create' && drag.day === day ? (
                <div
                  className="calendar-block calendar-ghost"
                  style={{
                    top: (Math.min(drag.fromMinute, drag.toMinute) / 60) * HOUR_HEIGHT,
                    height: (Math.abs(drag.toMinute - drag.fromMinute) / 60) * HOUR_HEIGHT,
                    left: 2,
                    width: 'calc(100% - 4px)',
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">Drag on an empty slot to add an entry. Drag a block to move it, or its bottom edge to change the end. Click a block to edit it.</p>
      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
