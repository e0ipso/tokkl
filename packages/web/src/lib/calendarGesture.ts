import type { TimeEntry } from '@tokkl/types';
import { clampDayMove } from './calendarDay.ts';
import { pxToMinute, snapMinute } from './calendarLayout.ts';

/**
 * The gesture state machine of the week calendar's drags, with no DOM, timers or requests. The
 * hook in components/useCalendarDrag.ts feeds it pointer events and acts on what it returns.
 */

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
export const LONG_PRESS_MS = 500;
/** A held touch that moves further than this before the hold completes is a scroll. */
export const LONG_PRESS_TOLERANCE_PX = 10;

/** A touch that is being held on a column or block, and the drag it becomes if the hold completes. */
interface Press {
  readonly next: CalendarDrag;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A held touch and an active drag are tracked apart, as a mouse drag never waits for a hold. The
 * hook runs the hold timer while `press` is set: a new press object starts a new timer.
 */
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
  /** A pointer went down on a column or block; `next` is the drag it starts. */
  | ({ readonly type: 'down'; readonly pointerType: string; readonly next: CalendarDrag } & PointerAt)
  /** The hold timer of the current press ran out. */
  | { readonly type: 'held' }
  /** A pointer moved anywhere over the calendar. */
  | ({ readonly type: 'wander' } & PointerAt)
  /** The pointer moved the active drag to `drag` (see `followPointer`). */
  | { readonly type: 'follow'; readonly drag: CalendarDrag }
  /** The browser took the touch for a scroll. */
  | { readonly type: 'cancel' }
  /** The pointer is up or has left the calendar. */
  | { readonly type: 'up' };

/** What the hook must do after an event, beyond drawing the new state. */
export type GestureOutcome =
  | { readonly kind: 'none' }
  /** A touch hold became a drag, so the held finger's travel is not a swipe. */
  | { readonly kind: 'hold' }
  /** A touch lifted before the hold completed on a block: open it like a click. */
  | { readonly kind: 'tap'; readonly entry: TimeEntry }
  /** A drag ended: save it (see `dropChange` in calendarDrop.ts). */
  | { readonly kind: 'drop'; readonly drag: CalendarDrag };

interface GestureStep {
  readonly state: GestureState;
  readonly outcome: GestureOutcome;
}

const NONE: GestureOutcome = { kind: 'none' };

/**
 * The next state for `event`. Mouse and pen drags start at once. A touch waits out a hold; a lift,
 * a scroll or a finger that wanders past the tolerance before then leaves the gesture to the
 * browser, and a quick tap on a block opens it. A drop clears the drag before it is saved, so a
 * touch's pointer up and pointer leave in one go save the gesture at most once.
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

/** Whether a gesture is being held or dragged, when the grid must not open its context menu. */
export function isHolding(state: GestureState): boolean {
  return state.press !== null || state.drag !== null;
}

/**
 * Where the active drag goes as the pointer moves over the column of `day`. `minute` is the clock
 * minute under the pointer in that column. A create drag follows it on its own day only; a move or
 * resize follows the pointer's travel since it went down, in whole steps. A day-mode move stays on
 * the shown day; the week view lets a block cross midnight. An unchanged drag comes back as it is.
 */
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
