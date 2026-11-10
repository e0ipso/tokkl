import type { TimeEntry } from '@tokkl/types';
import { clampDayMove } from './calendarDay.ts';
import { pxToMinute, snapMinute } from './calendarLayout.ts';

/** No DOM, timers or requests; components/useCalendarDrag.ts feeds it pointer events. */

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

/** A touch drag starts after a hold, so a plain finger still scrolls. */
export const LONG_PRESS_MS = 500;
/** Moving further before the hold completes makes it a scroll. */
export const LONG_PRESS_TOLERANCE_PX = 10;

interface Press {
  readonly next: CalendarDrag;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

/** The hook runs the hold timer while `press` is set; a new press object starts a new timer. */
export interface GestureState {
  readonly press: Press | null;
  readonly drag: CalendarDrag | null;
}

export const IDLE: GestureState = { press: null, drag: null };

interface PointerAt {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

export type GestureEvent =
  | ({ readonly type: 'down'; readonly pointerType: string; readonly next: CalendarDrag } & PointerAt)
  | { readonly type: 'held' }
  | ({ readonly type: 'wander' } & PointerAt)
  | { readonly type: 'follow'; readonly drag: CalendarDrag }
  /** The browser took the touch for a scroll. */
  | { readonly type: 'cancel' }
  | { readonly type: 'up' };

export type GestureOutcome =
  | { readonly kind: 'none' }
  /** The held finger's travel is not a swipe. */
  | { readonly kind: 'hold' }
  /** A touch lifted before the hold on a block opens it like a click. */
  | { readonly kind: 'tap'; readonly entry: TimeEntry }
  | { readonly kind: 'drop'; readonly drag: CalendarDrag };

interface GestureStep {
  readonly state: GestureState;
  readonly outcome: GestureOutcome;
}

const NONE: GestureOutcome = { kind: 'none' };

/**
 * Touch waits out a hold; lifting, scrolling or wandering first leaves it to the browser. A drop clears
 * the drag first, so pointer up and leave together save once.
 */
export function stepGesture(state: GestureState, event: GestureEvent): GestureStep {
  switch (event.type) {
    case 'down':
      if (event.pointerType !== 'touch') return { state: { ...state, drag: event.next }, outcome: NONE };
      return {
        state: { ...state, press: { next: event.next, pointerId: event.pointerId, x: event.x, y: event.y } },
        outcome: NONE,
      };
    case 'held':
      if (!state.press) return { state, outcome: NONE };
      return { state: { press: null, drag: state.press.next }, outcome: { kind: 'hold' } };
    case 'wander': {
      const press = state.press;
      const wandered =
        press !== null &&
        press.pointerId === event.pointerId &&
        Math.hypot(event.x - press.x, event.y - press.y) > LONG_PRESS_TOLERANCE_PX;
      return { state: wandered ? { ...state, press: null } : state, outcome: NONE };
    }
    case 'follow':
      if (!state.drag || state.drag === event.drag) return { state, outcome: NONE };
      return { state: { ...state, drag: event.drag }, outcome: NONE };
    case 'cancel':
      return { state: IDLE, outcome: NONE };
    case 'up': {
      const { press, drag } = state;
      if (drag) return { state: IDLE, outcome: { kind: 'drop', drag } };
      if (press && press.next.kind !== 'create')
        return { state: IDLE, outcome: { kind: 'tap', entry: press.next.entry } };
      return { state: IDLE, outcome: NONE };
    }
  }
}

/** Then the grid must not open its context menu. */
export function isHolding(state: GestureState): boolean {
  return state.press !== null || state.drag !== null;
}

/** A create follows its own day only; a move or resize follows the travel in whole steps. */
export function followPointer(
  drag: CalendarDrag,
  pointer: { readonly day: string; readonly minute: number; readonly y: number },
  stepMinutes: number,
  dayMode: boolean,
): CalendarDrag {
  if (drag.kind === 'create') {
    if (drag.day !== pointer.day) return drag;
    const toMinute = snapMinute(pointer.minute, stepMinutes);
    return toMinute === drag.toMinute ? drag : { ...drag, toMinute };
  }
  const snapped = Math.round(pxToMinute(pointer.y - drag.originY) / stepMinutes) * stepMinutes;
  const delta = dayMode && drag.kind === 'move' ? clampDayMove(snapped, drag.startMinute, drag.endMinute) : snapped;
  return delta === drag.deltaMinutes ? drag : { ...drag, deltaMinutes: delta };
}
