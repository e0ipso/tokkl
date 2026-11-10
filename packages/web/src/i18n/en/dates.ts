import type { MessageGroup } from '../catalog.ts';

/** Names come from `Intl` in the interface locale; these patterns only order them. */
export const dates = {
  shortDate: '{day} {month}',
  dayLabel: '{weekday}, {date}',
  dayLabelWithYear: '{weekday}, {date} {year}',
  time24: '{hour}:{minute}',
  time12: '{hour}:{minute} {period}',
  dateTime: '{date} {time}',
  timeRange: '{start} – {end}',
  dateWithYear: '{date} {year}',
  monthYear: '{month} {year}',
  weekdayDay: '{weekday} {day}',
} as const satisfies MessageGroup;
