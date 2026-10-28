import type { TimeEntry, TimerPause } from '../api/types.ts';
import type { EntryDraft } from './useEntryFields.ts';

/**
 * What the timer bar reads from the server's pause chain. Plain TypeScript with no React or DOM,
 * so node:test can load it.
 */

/** The fields Resume starts, as the bar's draft. */
export function pauseDraft(pause: TimerPause): EntryDraft {
  return {
    description: pause.description, project_id: pause.project_id, task_id: pause.task_id,
    tags: [...pause.tags], billable: pause.billable,
  };
}

/**
 * Seconds the bar's clock shows: the chain total while paused or while its clone runs, otherwise
 * the running entry's own time, and 0 when idle. `serverNowMs` is the server-corrected clock.
 */
export function barSeconds(running: Pick<TimeEntry, 'id' | 'start'> | null, pause: TimerPause | null, serverNowMs: number): number {
  if (running) {
    const elapsed = Math.max(0, Math.floor((serverNowMs - Date.parse(running.start)) / 1000));
    return pause && !pause.paused && pause.clone_entry_id === running.id ? pause.seconds + elapsed : elapsed;
  }
  return pause?.paused ? pause.seconds : 0;
}
