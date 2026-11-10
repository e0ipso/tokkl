import type { MessageGroup } from '../catalog.ts';

export const calendar = {
  previousDay: 'Previous day',
  previousWeek: 'Previous week',
  nextDay: 'Next day',
  nextWeek: 'Next week',
  currentDay: 'Current day',
  currentDayTitle: 'Current day (T)',
  thisWeek: 'This week',
  thisWeekTitle: 'This week (T)',
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

  blockTitle: '{label}\n{range}',
  now: 'now',
  /** Before a tall block's duration. */
  projectPrefix: '{project} · ',
  /** After a short block's description, on its one line. */
  projectSuffix: ' · {project}',
  editBlock: 'Edit {label}',

  loadingWeek: 'Loading week…',
  loadFailed: 'Could not load this week: {message}',
  hint: 'Drag on an empty slot to add an entry. Drag a block to move it, or its bottom edge to change the end. Click a block to edit it.',
} as const satisfies MessageGroup;
