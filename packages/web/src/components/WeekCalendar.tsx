import { useEffect, useMemo, useRef, useState } from 'react';
import { useCreateEntry, useEntries, useUpdateEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { addClockMinutes, addDays, clockSpanOnDay, startOfWeek } from '@tokkl/common/time';
import { instantAt, localDay } from '../lib/entryTime.ts';
import { DAY_MODE_QUERY, classifySwipe, clampDayMove, stepDay, type SwipeDirection } from '../lib/calendarDay.ts';
import { dayLabel, duration, shortDate, entrySeconds, formatTime, minutesOfDay, today, useNow, useSettings, weekdayName } from '../lib/settings.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { arrowTarget } from './arrowKeys.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { LoadError, Loading } from './PageState.tsx';
import { projectColorStyle } from './Pickers.tsx';
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
  // Below 760px the grid shows one day; the week it belongs to still loads, for the strip's totals.
  const dayMode = useMediaQuery(DAY_MODE_QUERY);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  // The side the shown day came in from; the grid remounts per day, so the slide plays once.
  const [slide, setSlide] = useState<SwipeDirection | null>(null);
  const weekStart = startOfWeek(selectedDay, settings.beginningOfWeek);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const days = useMemo(() => (dayMode ? [selectedDay] : weekDays), [dayMode, selectedDay, weekDays]);
  // A week that has not loaded shows the Loading state over the grid, not an empty week.
  const { data, isLoading, error, refetch } = useEntries(addDays(weekStart, -1), addDays(weekStart, 7));
  const entries = useMemo(() => data ?? [], [data]);
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const toast = useToast();
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stripButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // Where a day-mode gesture on the grid began, until pointer up decides whether it was a swipe.
  const swipeStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const blocks = useMemo(() => layout(entries, days, settings.timeZone, now), [entries, days, settings.timeZone, now]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, []);

  const selectDay = (day: string) => {
    if (day !== selectedDay) setSlide(day > selectedDay ? 'next' : 'previous');
    setSelectedDay(day);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || document.querySelector('.modal, .popover')) return;
      if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey) {
        selectDay(todayKey);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // selectDay reads selectedDay, so the listener is renewed when the day changes.
  }, [todayKey, selectedDay]);

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
      // Blocks are drawn on the local clock, so drops move endpoints by clock minutes, not elapsed time.
      const start = new Date(current.entry.start);
      if (current.kind === 'move') {
        // The start lands on the dropped slot; the entry keeps its elapsed duration.
        const movedStart = addClockMinutes(start, current.deltaMinutes, settings.timeZone);
        const duration = current.entry.stop ? Date.parse(current.entry.stop) - start.getTime() : null;
        await update.mutateAsync({
          id: current.entry.id,
          start: movedStart.toISOString(),
          ...(duration !== null ? { stop: new Date(movedStart.getTime() + duration).toISOString() } : {}),
        });
      } else if (current.entry.stop) {
        const dropped = addClockMinutes(new Date(current.entry.stop), current.deltaMinutes, settings.timeZone).getTime();
        const stop = Math.max(start.getTime() + MIN_BLOCK_MINUTES * 60_000, dropped);
        await update.mutateAsync({ id: current.entry.id, stop: new Date(stop).toISOString() });
      }
    } catch (error) {
      toast.error(error);
    }
  };

  // The arrows step one day in day mode and one week otherwise; stepping the selected day by seven
  // keeps the derived week start on the same weekday, so the week view moves a whole week.
  const step = (direction: 1 | -1) => selectDay(stepDay(selectedDay, dayMode ? direction : direction * 7));
  const dayTotal = (day: string) => entries
    .filter((entry) => localDay(entry.start, settings.timeZone) === day)
    .reduce((sum, entry) => sum + entrySeconds(entry, now), 0);
  const weekTotal = entries
    .filter((entry) => { const day = localDay(entry.start, settings.timeZone); return day >= weekStart && day <= weekDays[6]!; })
    .reduce((sum, entry) => sum + entrySeconds(entry, now), 0);
  const nowMinute = minutesOfDay(now, settings.timeZone);
  // A gesture that edits nothing (no drag, or a create drag that never grew) can still be a swipe.
  const gestureEditsNothing = !drag || (drag.kind === 'create' && drag.fromMinute === drag.toMinute);

  return (
    <div className={`calendar${dayMode ? ' day-mode' : ''}`} onPointerUp={() => void finishDrag()} onPointerLeave={() => drag && void finishDrag()}>
      <div className="calendar-toolbar">
        {dayMode ? (
          <>
            <button type="button" className="icon-button" aria-label="Previous day" onClick={() => step(-1)}><Icon name="chevronLeft" /></button>
            <button type="button" className="button button-ghost" onClick={() => selectDay(todayKey)} title="Current day (T)">
              Current day
            </button>
            <button type="button" className="icon-button" aria-label="Next day" onClick={() => step(1)}><Icon name="chevronRight" /></button>
            <span className="calendar-range">{weekdayName(selectedDay)}, {shortDate(selectedDay)}</span>
          </>
        ) : (
          <>
            <button type="button" className="icon-button" aria-label="Previous week" onClick={() => step(-1)}><Icon name="chevronLeft" /></button>
            <button type="button" className="button button-ghost" onClick={() => selectDay(todayKey)} title="This week (T)">
              This week
            </button>
            <button type="button" className="icon-button" aria-label="Next week" onClick={() => step(1)}><Icon name="chevronRight" /></button>
            <span className="calendar-range">{shortDate(weekDays[0]!)} to {shortDate(weekDays[6]!)}</span>
          </>
        )}
        <span className="spacer" />
        <span className="muted">Week total <strong>{duration(weekTotal, settings)}</strong></span>
      </div>
      {dayMode ? (
        // The week's days as one Tab stop: arrows, Home and End move between them and select.
        <div className="calendar-strip" role="group" aria-label="Days of the week">
          {weekDays.map((day, index) => (
            <button
              key={day}
              ref={(element) => { stripButtons.current[index] = element; }}
              type="button"
              className={`calendar-strip-day${day === todayKey ? ' today' : ''}`}
              aria-pressed={day === selectedDay}
              aria-label={`${weekdayName(day)} ${shortDate(day)}, ${duration(dayTotal(day), settings)}`}
              tabIndex={day === selectedDay ? 0 : -1}
              onClick={() => selectDay(day)}
              onKeyDown={(event) => {
                const next = arrowTarget(event.key, index, weekDays.length);
                if (next === null) return;
                event.preventDefault();
                selectDay(weekDays[next]!);
                stripButtons.current[next]?.focus();
              }}
            >
              <span className="calendar-strip-weekday">{weekdayName(day)}</span>
              <span className="calendar-strip-date">{shortDate(day)}</span>
              <small>{duration(dayTotal(day), settings)}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="calendar-head">
          <div className="calendar-gutter" />
          {weekDays.map((day) => (
            <div key={day} className={`calendar-day-head${day === todayKey ? ' today' : ''}`}>
              <span>{dayLabel(day, todayKey)}</span>
              <small>{duration(dayTotal(day), settings)}</small>
            </div>
          ))}
        </div>
      )}
      <div className="calendar-frame">
        <div
          className="calendar-body"
          ref={scroller}
          onPointerDown={(event) => {
            if (dayMode && event.isPrimary) swipeStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!dayMode || !start || start.pointerId !== event.pointerId || !gestureEditsNothing) return;
            const direction = classifySwipe(event.clientX - start.x, event.clientY - start.y);
            if (direction) step(direction === 'next' ? 1 : -1);
          }}
          onPointerCancel={() => { swipeStart.current = null; }}
        >
          <div
            key={dayMode ? selectedDay : 'week'}
            className="calendar-grid"
            style={{ height: 24 * HOUR_HEIGHT }}
            data-slide={dayMode && slide ? slide : undefined}
          >
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
                    const snapped = Math.round(((event.clientY - drag.originY) / HOUR_HEIGHT) * 60 / SNAP_MINUTES) * SNAP_MINUTES;
                    // A day-mode move stays on the shown day; the week view lets a block cross midnight.
                    const delta = dayMode && drag.kind === 'move' ? clampDayMove(snapped, drag.startMinute, drag.endMinute) : snapped;
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
                  const width = 100 / block.lanes;
                  const { description, project_name: projectName } = block.entry;
                  const elapsed = duration(entrySeconds(block.entry, now), settings);
                  const label = [description || '(no description)', projectName, elapsed].filter(Boolean).join(', ');
                  const heading = description || projectName || '(no description)';
                  return (
                    <div
                      key={`${block.entry.id}-${day}`}
                      className={`calendar-block${block.entry.stop ? '' : ' running'}${active ? ' dragging' : ''}`}
                      style={{
                        top: (top / 60) * HOUR_HEIGHT,
                        height: Math.max(((bottom - top) / 60) * HOUR_HEIGHT, 6),
                        left: `calc(${block.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        ...projectColorStyle(block.entry.project_color ?? 'var(--muted)'),
                      }}
                      role="group"
                      aria-label={label}
                      title={`${label}\n${formatTime(block.entry.start, settings)} – ${block.entry.stop ? formatTime(block.entry.stop, settings) : 'now'}`}
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
                      {bottom - top >= 45 ? (
                        <>
                          <strong>{heading}</strong>
                          <span>
                            {projectName ? `${projectName} · ` : null}
                            <span className="calendar-block-duration">{elapsed}</span>
                          </span>
                        </>
                      ) : (
                        <div className="calendar-block-line">
                          <strong>{heading}</strong>
                          {description && projectName ? <span> · {projectName}</span> : null}
                        </div>
                      )}
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
        {isLoading ? <Loading label="Loading week…" className="calendar-state" /> : error && !data ? (
          <LoadError className="calendar-state" message={`Could not load this week: ${error.message}`} onRetry={() => void refetch()} />
        ) : null}
      </div>
      <p className="hint">Drag on an empty slot to add an entry. Drag a block to move it, or its bottom edge to change the end. Click a block to edit it.</p>
      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
