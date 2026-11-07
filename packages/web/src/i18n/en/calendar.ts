import type { MessageGroup } from '../catalog.ts';

/** The week calendar: toolbar, day strip, all-day row and dialog, and the hour grid's blocks. */
export const calendar = {
  previousDay: 'Previous day',
  previousWeek: 'Previous week',
  nextDay: 'Next day',
  nextWeek: 'Next week',
  currentDay: 'Current day',
  currentDayTitle: 'Current day (T)',
  thisWeek: 'This week',
  thisWeekTitle: 'This week (T)',
  /** The shown week, such as "22 Jun to 28 Jun". */
  weekRange: '{from} to {to}',
  weekTotal: 'Week total',
  daysOfWeek: 'Days of the week',
  /** A day in the phone's strip: "Mon 22 Jun, 1:30:00". */
  stripDay: '{weekday} {date}, {total}',

  allDayEntries: 'All-day entries',
  allDay: 'All day',
  addAllDayFor: 'Add all-day entry for {day}',
  addAllDayTitle: 'Add all-day entry',
  adding: 'Adding…',
  addEntry: 'Add entry',
  durationPlaceholder: 'e.g. 1:30 or 90m',

  /** A block's tooltip: its name, then its times on the next line. */
  blockTitle: '{label}\n{range}',
  /** The end of a running block's time range. */
  now: 'now',
  /** The project before a tall block's duration. */
  projectPrefix: '{project} · ',
  /** The project after a short block's description, on its one line. */
  projectSuffix: ' · {project}',
  editBlock: 'Edit {label}',

  loadingWeek: 'Loading week…',
  loadFailed: 'Could not load this week: {message}',
  hint: 'Drag on an empty slot to add an entry. Drag a block to move it, or its bottom edge to change the end. Click a block to edit it.',
} as const satisfies MessageGroup;
