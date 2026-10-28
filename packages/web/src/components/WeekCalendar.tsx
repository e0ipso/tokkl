import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useCreateEntry, useEntries, useUpdateEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { addClockMinutes, addDays, clockSpanOnDay, startOfDay, startOfWeek } from '@tokkl/common/time';
import { instantAt, localDay } from '../lib/entryTime.ts';
import { assignLanes, heightClearingMarkers } from '../lib/calendarLanes.ts';
import { DAY_MODE_QUERY, classifySwipe, clampDayMove, dragStep, droppedMinute, fitMoveInDay, splitAllDay, stepDay, type SwipeDirection } from '../lib/calendarDay.ts';
import { dayLabel, duration, shortDate, entrySeconds, formatTime, minutesOfDay, snappedInstant, snappedSeconds, today, useNow, useSettings, weekdayName } from '../lib/settings.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { arrowTarget } from './arrowKeys.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { Icon } from './Icon.tsx';
import { LoadError, Loading } from './PageState.tsx';
import { projectColorStyle } from './Pickers.tsx';
import { useToast } from './Toast.tsx';

const HOUR_HEIGHT = 48;
// A block never draws shorter than this, so a zero-length entry is a thin bar at its start.
const MIN_BLOCK_HEIGHT = 6;
// A touch drag starts after a hold, so a plain finger still scrolls the grid.
const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 10;

type Drag =
  | { kind: 'create'; day: string; fromMinute: number; toMinute: number }
  | { kind: 'move' | 'resize'; entry: TimeEntry; day: string; originY: number; startMinute: number; endMinute: number; deltaMinutes: number };

/** A touch that is being held on a column or block, and the drag it becomes if the hold completes. */
interface LongPress {
  next: Drag;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
}

/** A clock minute rounded to whole drag steps, kept on the day. */
function snap(minutes: number, step: number): number {
  return Math.max(0, Math.min(24 * 60, Math.round(minutes / step) * step));
}

interface Block {
  entry: TimeEntry;
  day: string;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  /** The least height to draw, in pixels: tall enough to show below a zero-length marker over its start. */
  minHeight: number;
}

/** Lays out the part of each entry that falls on each day, side by side where their stored spans overlap. */
function layout(entries: TimeEntry[], days: string[], timeZone: string, now: Date): Block[] {
  const blocks: Block[] = [];
  for (const day of days) {
    const onDay = entries.flatMap((entry): Block[] => {
      const span = clockSpanOnDay(new Date(entry.start), entry.stop ? new Date(entry.stop) : now, day, timeZone);
      return span ? [{ entry, day, top: span.top, bottom: span.bottom, lane: 0, lanes: 1, minHeight: MIN_BLOCK_HEIGHT }] : [];
    });
    const laid = assignLanes(onDay);
    for (const block of laid) block.minHeight = heightClearingMarkers(block, laid, HOUR_HEIGHT / 60, MIN_BLOCK_HEIGHT);
    blocks.push(...laid);
  }
  return blocks;
}

export function WeekCalendar() {
  const settings = useSettings();
  const stepMinutes = dragStep(settings.timeResolution);
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
  // Mirrors drag for handlers that run before React re-renders. A touch fires pointer up and then
  // pointer leave in one go, so finishDrag clears the ref first and the gesture saves at most once.
  const dragRef = useRef<Drag | null>(null);
  const longPress = useRef<LongPress | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stripButtons = useRef<(HTMLButtonElement | null)[]>([]);
  // Where a day-mode gesture on the grid began, until pointer up decides whether it was a swipe.
  const swipeStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  // No-time entries have no place on the clock, so only timed ones reach the lane layout.
  const { timed, allDay } = useMemo(() => splitAllDay(entries, days, settings.timeZone), [entries, days, settings.timeZone]);
  const blocks = useMemo(() => layout(timed, days, settings.timeZone, now), [timed, days, settings.timeZone, now]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, []);

  // React's touch handlers are passive and touch-action can't change mid-gesture, so only a native
  // non-passive touchmove listener can keep the grid from scrolling once a touch drag is active.
  useEffect(() => {
    const element = root.current;
    const onTouchMove = (event: TouchEvent) => {
      // A touch that lands during a fling stays uncancelable; the browser keeps that one as a scroll.
      if (dragRef.current && event.cancelable) event.preventDefault();
    };
    element?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      element?.removeEventListener('touchmove', onTouchMove);
      if (longPress.current) window.clearTimeout(longPress.current.timer);
    };
  }, []);

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const cancelLongPress = () => {
    if (!longPress.current) return;
    window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  // Mouse and pen drags start at once. A touch waits out the hold; a lift, a scroll or a finger
  // that wanders past the tolerance before then leaves the gesture to the browser.
  const beginDrag = (event: PointerEvent, next: Drag) => {
    if (event.pointerType !== 'touch') {
      updateDrag(next);
      return;
    }
    cancelLongPress();
    const timer = window.setTimeout(() => {
      longPress.current = null;
      // The held finger is dragging now, so its travel must not count as a swipe on pointer up.
      swipeStart.current = null;
      updateDrag(next);
    }, LONG_PRESS_MS);
    longPress.current = { next, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer };
  };

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
    const press = longPress.current;
    cancelLongPress();
    const current = dragRef.current;
    // A touch that lifts before the long press fires is a tap, and a tapped block opens like a click.
    if (!current && press && press.next.kind !== 'create') setEditing(press.next.entry);
    if (!current) return;
    updateDrag(null);
    try {
      if (current.kind === 'create') {
        // A plain click (no drag) does nothing; creating needs a dragged range.
        if (current.toMinute === current.fromMinute) return;
        // Whole steps from midnight are on the resolution grid, so the range needs no snapping.
        const from = Math.min(Math.min(current.fromMinute, current.toMinute), 24 * 60 - stepMinutes);
        const to = Math.max(current.fromMinute, current.toMinute, from + stepMinutes);
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
      // The dropped boundary then goes to the nearest point of the resolution grid, as the preview
      // shows it, so an entry imported off the grid lands on it and the server keeps the drop.
      const start = new Date(current.entry.start);
      const dropAt = (from: Date) => snappedInstant(addClockMinutes(from, current.deltaMinutes, settings.timeZone), settings).getTime();
      if (current.kind === 'move') {
        // The start lands on the dropped slot and the entry keeps the duration the server stores
        // for it, so an entry imported off the grid moves as the span it would snap to.
        let movedStart = dropAt(start);
        const stop = current.entry.stop ? Date.parse(current.entry.stop) : null;
        const stored = stop === null ? 0 : snappedSeconds(start, new Date(stop), settings) * 1000;
        if (dayMode && stop !== null) {
          // The clamp kept the clock span on the day, but on a 25-hour day the elapsed duration
          // can still carry the stop into the next day, so the fit keeps the stored stop on the day.
          const dayEnd = startOfDay(addDays(current.day, 1), settings.timeZone).getTime();
          movedStart = fitMoveInDay(movedStart, stored, stop, dayEnd);
        }
        await update.mutateAsync({
          id: current.entry.id,
          start: new Date(movedStart).toISOString(),
          ...(stop !== null ? { stop: new Date(movedStart + stored).toISOString() } : {}),
        });
      } else if (current.entry.stop) {
        // The server moves an off-grid start to its nearest grid point, so the shortest block is
        // measured from there.
        const gridStart = snappedInstant(start, settings).getTime();
        const stop = Math.max(gridStart + stepMinutes * 60_000, dropAt(new Date(current.entry.stop)));
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
    <div
      ref={root}
      className={`calendar${dayMode ? ' day-mode' : ''}`}
      onPointerMove={(event) => {
        const press = longPress.current;
        if (press && press.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_TOLERANCE_PX) {
          cancelLongPress();
        }
      }}
      onPointerUp={() => void finishDrag()}
      onPointerLeave={() => void finishDrag()}
      // The browser took the touch for a scroll, so a held or dragged block goes back where it was.
      onPointerCancel={() => { cancelLongPress(); updateDrag(null); }}
    >
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
      {allDay.size > 0 ? (
        // One cell per shown day, in the columns of the day heads. Chips open the editor and take no part in grid gestures.
        <div className="calendar-all-day" role="group" aria-label="All-day entries">
          <div className="calendar-all-day-label">All day</div>
          {days.map((day) => (
            <div key={day} className="calendar-all-day-cell">
              {(allDay.get(day) ?? []).map((entry) => {
                const elapsed = duration(entrySeconds(entry, now), settings);
                const label = [entry.description || '(no description)', entry.project_name, elapsed].filter(Boolean).join(', ');
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="calendar-chip"
                    style={projectColorStyle(entry.project_color ?? 'var(--muted)')}
                    aria-label={label}
                    title={label}
                    onClick={() => setEditing(entry)}
                  >
                    <strong>{entry.description || entry.project_name || '(no description)'}</strong>
                    <span className="calendar-block-duration">{elapsed}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      <div className="calendar-frame">
        <div
          className="calendar-body"
          ref={scroller}
          // Capture phase: a block stops its pointer down from bubbling, but a swipe may start on it.
          onPointerDownCapture={(event) => {
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
            // Android Chrome opens a context menu on a long press; a right-click still gets one.
            onContextMenu={(event) => { if (longPress.current || dragRef.current) event.preventDefault(); }}
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
                  const minute = snap(minuteAt(event.clientY, event.currentTarget), stepMinutes);
                  beginDrag(event, { kind: 'create', day, fromMinute: minute, toMinute: minute });
                }}
                onPointerMove={(event) => {
                  if (!drag) return;
                  if (drag.kind === 'create' && drag.day === day) {
                    updateDrag({ ...drag, toMinute: snap(minuteAt(event.clientY, event.currentTarget), stepMinutes) });
                  } else if (drag.kind !== 'create') {
                    const snapped = Math.round(((event.clientY - drag.originY) / HOUR_HEIGHT) * 60 / stepMinutes) * stepMinutes;
                    // A day-mode move stays on the shown day; the week view lets a block cross midnight.
                    const delta = dayMode && drag.kind === 'move' ? clampDayMove(snapped, drag.startMinute, drag.endMinute) : snapped;
                    if (delta !== drag.deltaMinutes) updateDrag({ ...drag, deltaMinutes: delta });
                  }
                }}
              >
                {day === todayKey ? <div className="calendar-now" style={{ top: (nowMinute / 60) * HOUR_HEIGHT }} /> : null}
                {blocks.filter((block) => block.day === day).map((block) => {
                  const active = drag && drag.kind !== 'create' && drag.entry.id === block.entry.id;
                  let top = block.top;
                  let bottom = block.bottom;
                  if (active && drag.kind === 'move') {
                    top = droppedMinute(block.top, drag.deltaMinutes, settings.timeResolution);
                    bottom += top - block.top;
                  } else if (active && drag.kind === 'resize') {
                    bottom = Math.max(top + stepMinutes, droppedMinute(bottom, drag.deltaMinutes, settings.timeResolution));
                  }
                  const width = 100 / block.lanes;
                  const storedHeight = ((bottom - top) / 60) * HOUR_HEIGHT;
                  const { description, project_name: projectName } = block.entry;
                  const elapsed = duration(entrySeconds(block.entry, now), settings);
                  const label = [description || '(no description)', projectName, elapsed].filter(Boolean).join(', ');
                  const heading = description || projectName || '(no description)';
                  return (
                    <div
                      key={`${block.entry.id}-${day}`}
                      className={`calendar-block${block.entry.stop ? '' : ' running'}${storedHeight < MIN_BLOCK_HEIGHT ? ' thin' : ''}${storedHeight === 0 ? ' marker' : ''}${active ? ' dragging' : ''}`}
                      style={{
                        top: (top / 60) * HOUR_HEIGHT,
                        height: Math.max(storedHeight, active ? MIN_BLOCK_HEIGHT : block.minHeight),
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
                        beginDrag(event, {
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
