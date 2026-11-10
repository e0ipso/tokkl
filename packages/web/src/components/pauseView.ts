import type { TimeEntry, TimerPause } from '@tokkl/types';
import type { EntryDraft } from './useEntryFields.ts';

/** No React or DOM, so node:test can load it. */

export function pauseDraft(pause: TimerPause): EntryDraft {
  return {
    description: pause.description,
    project_id: pause.project_id,
    task_id: pause.task_id,
    tags: [...pause.tags],
    billable: pause.billable,
  };
}

/** The chain total while paused or while its clone runs, else the running entry's own time, 0 when idle. */
export function barSeconds(
  running: Pick<TimeEntry, 'id' | 'start'> | null,
  pause: TimerPause | null,
  serverNowMs: number,
): number {
  if (running) {
    const elapsed = Math.max(0, Math.floor((serverNowMs - Date.parse(running.start)) / 1000));
    return pause && !pause.paused && pause.clone_entry_id === running.id ? pause.seconds + elapsed : elapsed;
  }
  return pause?.paused ? pause.seconds : 0;
}
