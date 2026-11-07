import { addClockMinutes, addDays, startOfDay } from '@tokkl/common/time';
import type { TimeEntry } from '../api/types.ts';
import { dragStep, fitMoveInDay } from './calendarDay.ts';
import type { CalendarDrag } from './calendarGesture.ts';
import { DAY_MINUTES } from './calendarLayout.ts';
import { instantAt } from './entryTime.ts';
import type { Settings } from './settings.ts';
import { snappedInstant, snappedSeconds } from './snapping.ts';

/** What a finished calendar drag does to the entries, as the server should receive it. */
export type DropChange =
  /** A plain click on an empty slot, or a resize of a running entry: nothing to save. */
  | { readonly kind: 'none' }
  /** A click on a block that did not move it: open it in the editor. */
  | { readonly kind: 'open'; readonly entry: TimeEntry }
  /** A create drag: a new entry over the dragged range, opened once saved. */
  | { readonly kind: 'create'; readonly start: string; readonly stop: string }
  /** A move or resize: the new start and stop of the entry, a field left out staying as it is. */
  | { readonly kind: 'update'; readonly id: number; readonly start?: string; readonly stop?: string };

type DropSettings = Pick<Settings, 'timeZone' | 'timeResolution'>;

/** The new entry a create drag over clock minutes `fromMinute` to `toMinute` of `day` makes. */
function createChange(drag: Extract<CalendarDrag, { kind: 'create' }>, settings: DropSettings): DropChange {
  // A plain click (no drag) does nothing; creating needs a dragged range.
  if (drag.toMinute === drag.fromMinute) return { kind: 'none' };
  const stepMinutes = dragStep(settings.timeResolution);
  // Whole steps from midnight are on the resolution grid, so the range needs no snapping.
  const from = Math.min(Math.min(drag.fromMinute, drag.toMinute), DAY_MINUTES - stepMinutes);
  const to = Math.max(drag.fromMinute, drag.toMinute, from + stepMinutes);
  return {
    kind: 'create',
    start: instantAt(drag.day, from, settings.timeZone).toISOString(),
    stop: instantAt(drag.day, Math.min(to, DAY_MINUTES - 1), settings.timeZone).toISOString(),
  };
}

/**
 * The change a finished drag makes. Blocks are drawn on the local clock, so drops move endpoints
 * by clock minutes, not elapsed time. The dropped boundary then goes to the nearest point of the
 * resolution grid, as the preview shows it, so an entry imported off the grid lands on it and the
 * server keeps the drop. `dayMode` keeps a move on the shown day, also on a 25-hour day.
 */
export function dropChange(drag: CalendarDrag, settings: DropSettings, dayMode: boolean): DropChange {
  if (drag.kind === 'create') return createChange(drag, settings);
  const { entry, deltaMinutes } = drag;
  if (deltaMinutes === 0) return { kind: 'open', entry };
  const start = new Date(entry.start);
  const dropAt = (from: Date) =>
    snappedInstant(addClockMinutes(from, deltaMinutes, settings.timeZone), settings).getTime();
  if (drag.kind === 'move') {
    // The start lands on the dropped slot and the entry keeps the duration the server stores for
    // it, so an entry imported off the grid moves as the span it would snap to.
    let movedStart = dropAt(start);
    const stop = entry.stop ? Date.parse(entry.stop) : null;
    const stored = stop === null ? 0 : snappedSeconds(start, new Date(stop), settings) * 1000;
    if (dayMode && stop !== null) {
      // The clamp kept the clock span on the day, but on a 25-hour day the elapsed duration can
      // still carry the stop into the next day, so the fit keeps the stored stop on the day.
      const dayEnd = startOfDay(addDays(drag.day, 1), settings.timeZone).getTime();
      movedStart = fitMoveInDay(movedStart, stored, stop, dayEnd);
    }
    return {
      kind: 'update',
      id: entry.id,
      start: new Date(movedStart).toISOString(),
      ...(stop !== null ? { stop: new Date(movedStart + stored).toISOString() } : {}),
    };
  }
  if (!entry.stop) return { kind: 'none' };
  // The server moves an off-grid start to its nearest grid point, so the shortest block is
  // measured from there.
  const gridStart = snappedInstant(start, settings).getTime();
  const stop = Math.max(gridStart + dragStep(settings.timeResolution) * 60_000, dropAt(new Date(entry.stop)));
  return { kind: 'update', id: entry.id, stop: new Date(stop).toISOString() };
}
