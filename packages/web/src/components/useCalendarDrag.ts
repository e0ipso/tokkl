import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { addClockMinutes, addDays, startOfDay } from '@tokkl/common/time';
import { useCreateEntry, useUpdateEntry } from '../api/entries.ts';
import type { TimeEntry } from '../api/types.ts';
import { clampDayMove, dragStep, fitMoveInDay } from '../lib/calendarDay.ts';
import { DAY_MINUTES, pxToMinute, snapMinute } from '../lib/calendarLayout.ts';
import { instantAt } from '../lib/entryTime.ts';
import type { Settings } from '../lib/settings.ts';
import { snappedInstant, snappedSeconds } from '../lib/snapping.ts';
import { useToast } from './Toast.tsx';

export type CalendarDrag =
  | { kind: 'create'; day: string; fromMinute: number; toMinute: number }
  | {
      kind: 'move' | 'resize';
      entry: TimeEntry;
      day: string;
      originY: number;
      startMinute: number;
      endMinute: number;
      deltaMinutes: number;
    };

/** A touch drag starts after a hold, so a plain finger still scrolls the grid. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 10;

/** A touch that is being held on a column or block, and the drag it becomes if the hold completes. */
interface LongPress {
  next: CalendarDrag;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
}

/** The clock minute under `clientY` in a day column. */
function minuteAt(clientY: number, column: HTMLElement): number {
  return pxToMinute(clientY - column.getBoundingClientRect().top);
}

/**
 * Dragging on the week calendar: on an empty slot to create an entry, on a block to move it, on its
 * bottom edge to change its end. Mouse and pen drags start at once. A touch waits out a hold; a
 * lift, a scroll or a finger that wanders past the tolerance before then leaves the gesture to the
 * browser, and a quick tap on a block opens it like a click.
 *
 * `onHold` runs when a touch hold turns into a drag, so the held finger's travel is not taken for a
 * swipe. `onOpen` opens an entry in the editor: a clicked or tapped block, or the entry a create
 * drag made.
 */
export function useCalendarDrag({
  root,
  settings,
  dayMode,
  onHold,
  onOpen,
}: {
  root: RefObject<HTMLElement | null>;
  settings: Settings;
  dayMode: boolean;
  onHold: () => void;
  onOpen: (entry: TimeEntry) => void;
}) {
  const stepMinutes = dragStep(settings.timeResolution);
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const toast = useToast();
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  // Mirrors drag for handlers that run before React re-renders. A touch fires pointer up and then
  // pointer leave in one go, so finish clears the ref first and the gesture saves at most once.
  const dragRef = useRef<CalendarDrag | null>(null);
  const longPress = useRef<LongPress | null>(null);

  const updateDrag = (next: CalendarDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const cancelLongPress = () => {
    if (!longPress.current) return;
    window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

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
  }, [root]);

  const begin = (event: PointerEvent, next: CalendarDrag) => {
    if (event.pointerType !== 'touch') {
      updateDrag(next);
      return;
    }
    cancelLongPress();
    const timer = window.setTimeout(() => {
      longPress.current = null;
      onHold();
      updateDrag(next);
    }, LONG_PRESS_MS);
    longPress.current = { next, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer };
  };

  /** Starts a create drag on an empty slot of `day`. */
  const beginCreate = (event: PointerEvent<HTMLElement>, day: string) => {
    const minute = snapMinute(minuteAt(event.clientY, event.currentTarget), stepMinutes);
    begin(event, { kind: 'create', day, fromMinute: minute, toMinute: minute });
  };

  /** Starts moving a block, or resizing it from its bottom edge. */
  const beginBlock = (
    event: PointerEvent,
    kind: 'move' | 'resize',
    block: { entry: TimeEntry; day: string; top: number; bottom: number },
  ) =>
    begin(event, {
      kind,
      entry: block.entry,
      day: block.day,
      originY: event.clientY,
      startMinute: block.top,
      endMinute: block.bottom,
      deltaMinutes: 0,
    });

  /** Follows the pointer over the column of `day`. */
  const moveOver = (event: PointerEvent<HTMLElement>, day: string) => {
    if (!drag) return;
    if (drag.kind === 'create' && drag.day === day) {
      updateDrag({ ...drag, toMinute: snapMinute(minuteAt(event.clientY, event.currentTarget), stepMinutes) });
    } else if (drag.kind !== 'create') {
      const snapped = Math.round(pxToMinute(event.clientY - drag.originY) / stepMinutes) * stepMinutes;
      // A day-mode move stays on the shown day; the week view lets a block cross midnight.
      const delta = dayMode && drag.kind === 'move' ? clampDayMove(snapped, drag.startMinute, drag.endMinute) : snapped;
      if (delta !== drag.deltaMinutes) updateDrag({ ...drag, deltaMinutes: delta });
    }
  };

  /** A pointer moved over the calendar: a held touch that wanders too far is a scroll, not a drag. */
  const wander = (event: PointerEvent) => {
    const press = longPress.current;
    if (
      press &&
      press.pointerId === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_TOLERANCE_PX
    ) {
      cancelLongPress();
    }
  };

  /** The browser took the touch for a scroll, so a held or dragged block goes back where it was. */
  const cancel = () => {
    cancelLongPress();
    updateDrag(null);
  };

  /** Saves the gesture once the pointer is up or has left the calendar. */
  const finish = async () => {
    const press = longPress.current;
    cancelLongPress();
    const current = dragRef.current;
    // A touch that lifts before the long press fires is a tap, and a tapped block opens like a click.
    if (!current && press && press.next.kind !== 'create') onOpen(press.next.entry);
    if (!current) return;
    updateDrag(null);
    try {
      if (current.kind === 'create') {
        // A plain click (no drag) does nothing; creating needs a dragged range.
        if (current.toMinute === current.fromMinute) return;
        // Whole steps from midnight are on the resolution grid, so the range needs no snapping.
        const from = Math.min(Math.min(current.fromMinute, current.toMinute), DAY_MINUTES - stepMinutes);
        const to = Math.max(current.fromMinute, current.toMinute, from + stepMinutes);
        const created = await create.mutateAsync({
          start: instantAt(current.day, from, settings.timeZone).toISOString(),
          stop: instantAt(current.day, Math.min(to, DAY_MINUTES - 1), settings.timeZone).toISOString(),
        });
        onOpen(created);
        return;
      }
      if (current.deltaMinutes === 0) {
        onOpen(current.entry);
        return;
      }
      // Blocks are drawn on the local clock, so drops move endpoints by clock minutes, not elapsed time.
      // The dropped boundary then goes to the nearest point of the resolution grid, as the preview
      // shows it, so an entry imported off the grid lands on it and the server keeps the drop.
      const start = new Date(current.entry.start);
      const dropAt = (from: Date) =>
        snappedInstant(addClockMinutes(from, current.deltaMinutes, settings.timeZone), settings).getTime();
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

  /** Whether a gesture is being held or dragged, when the grid must not open its context menu. */
  const holding = () => longPress.current !== null || dragRef.current !== null;

  return { drag, stepMinutes, beginCreate, beginBlock, moveOver, wander, cancel, finish, holding };
}
