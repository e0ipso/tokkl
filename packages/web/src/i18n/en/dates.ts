import type { MessageGroup } from '../catalog.ts';

/**
 * How dates and times are put together from their parts. Weekday, month, AM/PM and relative day
 * names come from `Intl` in the interface locale; these patterns only order them.
 */
export const dates = {
  /** A day and a short month name, such as "22 Jun". */
  shortDate: '{day} {month}',
  /** A day heading in the current year, such as "Mon, 22 Jun". */
  dayLabel: '{weekday}, {date}',
  /** A day heading in another year, such as "Mon, 22 Jun 2025". */
  dayLabelWithYear: '{weekday}, {date} {year}',
  /** A 24-hour clock time, such as "09:05". */
  time24: '{hour}:{minute}',
  /** A 12-hour clock time, such as "9:05 AM". */
  time12: '{hour}:{minute} {period}',
  /** A date and a time, such as "2026-03-10 09:30". */
  dateTime: '{date} {time}',
  /** A span of clock times, such as "09:00 – 10:30". */
  timeRange: '{start} – {end}',
} as const satisfies MessageGroup;
