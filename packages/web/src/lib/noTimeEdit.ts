import type { TimeEntryInput } from '../api/types.ts';

/**
 * The no-time fields to send when saving the editor in no-time mode. A no-time entry whose day and
 * duration are untouched sends none, so saving other fields leaves its time alone.
 */
export function noTimeFields(
  entry: { all_day: boolean },
  next: { day: string; seconds: number },
  initial: { day: string; seconds: number },
): Pick<TimeEntryInput, 'all_day' | 'start_date' | 'duration'> {
  if (entry.all_day && next.day === initial.day && next.seconds === initial.seconds) return {};
  return { all_day: true, start_date: next.day, duration: next.seconds };
}
