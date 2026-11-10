import type { TimeEntry, TimeEntryInput } from '@tokkl/types';
import { localDay } from './entryTime.ts';

/** Only stopped entries can be duplicated, so `duration` is the stored length, with no clock involved. */
export function duplicateInput(entry: TimeEntry, timeZone: string): TimeEntryInput {
  const { description, project_id, task_id, tags, billable } = entry;
  const when: TimeEntryInput = entry.all_day
    ? { all_day: true, start_date: localDay(entry.start, timeZone), duration: entry.duration }
    : { start: entry.start, stop: entry.stop };
  return { description, project_id, task_id, tags, billable, ...when };
}
