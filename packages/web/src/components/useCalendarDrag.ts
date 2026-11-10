import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useCreateEntry, useUpdateEntry, useUpdateRunningEntry } from '../api/entries.ts';
import type { TimeEntry } from '@tokkl/types';
import { dragStep } from '../lib/calendarDay.ts';
import { dropChange } from '../lib/calendarDrop.ts';
import {
  IDLE,
  LONG_PRESS_MS,
  followPointer,
  isHolding,
  stepGesture,
  type CalendarDrag,
  type GestureEvent,
  type GestureOutcome,
} from '../lib/calendarGesture.ts';
import { pxToMinute, snapMinute } from '../lib/calendarLayout.ts';
import type { Settings } from '../lib/settings.ts';
import { useToast } from './Toast.tsx';

function minuteAt(clientY: number, column: HTMLElement): number {
  return pxToMinute(clientY - column.getBoundingClientRect().top);
}

/**
 * Wires `stepGesture` (lib/calendarGesture.ts) and `dropChange` (lib/calendarDrop.ts) to pointer and touch events.
 * `onHold` marks a touch hold turning into a drag, so its travel is not a swipe.
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
  const updateRunning = useUpdateRunningEntry();
  const toast = useToast();
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  // Read by handlers before React re-renders. Pointer up then leave in one go saves once.
  const gesture = useRef(IDLE);
  const holdTimer = useRef<number | null>(null);

  const clearHoldTimer = () => {
    if (holdTimer.current === null) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const save = async (dropped: CalendarDrag) => {
    const change = dropChange(dropped, settings, dayMode);
    try {
      switch (change.kind) {
        case 'none':
          return;
        case 'open':
          onOpen(change.entry);
          return;
        case 'create':
          onOpen(await create.mutateAsync({ start: change.start, stop: change.stop }));
          return;
        case 'update': {
          const { kind: _, ...input } = change;
          await update.mutateAsync(input);
          return;
        }
        case 'moveRunning':
          // A conflict, once the entry stopped elsewhere, takes the server's state and fails with
          // the message the entry editor shows.
          await updateRunning.mutateAsync({ id: change.id, start: change.start });
          return;
      }
    } catch (error) {
      toast.error(error);
    }
  };

  const act = (outcome: GestureOutcome) => {
    switch (outcome.kind) {
      case 'none':
        return;
      case 'hold':
        onHold();
        return;
      case 'tap':
        onOpen(outcome.entry);
        return;
      case 'drop':
        void save(outcome.drag);
        return;
    }
  };

  const dispatch = (event: GestureEvent) => {
    const before = gesture.current;
    const { state, outcome } = stepGesture(before, event);
    gesture.current = state;
    if (state.press !== before.press) {
      clearHoldTimer();
      if (state.press) {
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          dispatch({ type: 'held' });
        }, LONG_PRESS_MS);
      }
    }
    if (state.drag !== before.drag) setDrag(state.drag);
    act(outcome);
  };

  // React's touch handlers are passive and touch-action can't change mid-gesture, so only a native
  // non-passive touchmove listener can keep the grid from scrolling once a touch drag is active.
  useEffect(() => {
    const element = root.current;
    const onTouchMove = (event: TouchEvent) => {
      // A touch that lands during a fling stays uncancelable; the browser keeps that one as a scroll.
      if (gesture.current.drag && event.cancelable) event.preventDefault();
    };
    element?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      element?.removeEventListener('touchmove', onTouchMove);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, [root]);

  const down = (event: PointerEvent, next: CalendarDrag) =>
    dispatch({
      type: 'down',
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      next,
    });

  const beginCreate = (event: PointerEvent<HTMLElement>, day: string) => {
    const minute = snapMinute(minuteAt(event.clientY, event.currentTarget), stepMinutes);
    down(event, { kind: 'create', day, fromMinute: minute, toMinute: minute });
  };

  const beginBlock = (
    event: PointerEvent,
    kind: 'move' | 'resize',
    block: { entry: TimeEntry; day: string; top: number; bottom: number },
  ) =>
    down(event, {
      kind,
      entry: block.entry,
      day: block.day,
      originY: event.clientY,
      startMinute: block.top,
      endMinute: block.bottom,
      deltaMinutes: 0,
    });

  const moveOver = (event: PointerEvent<HTMLElement>, day: string) => {
    const current = gesture.current.drag;
    if (!current) return;
    const pointer = { day, minute: minuteAt(event.clientY, event.currentTarget), y: event.clientY };
    dispatch({ type: 'follow', drag: followPointer(current, pointer, stepMinutes, dayMode) });
  };

  /** A held touch that wanders too far is a scroll, not a drag. */
  const wander = (event: PointerEvent) =>
    dispatch({ type: 'wander', pointerId: event.pointerId, x: event.clientX, y: event.clientY });

  /** A held or dragged block goes back where it was. */
  const cancel = () => dispatch({ type: 'cancel' });

  const finish = () => dispatch({ type: 'up' });

  const holding = () => isHolding(gesture.current);

  return { drag, stepMinutes, beginCreate, beginBlock, moveOver, wander, cancel, finish, holding };
}
