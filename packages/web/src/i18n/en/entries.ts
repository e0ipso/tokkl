import type { MessageGroup } from '../catalog.ts';

/**
 * Time entries: the timer page around the list, the list and its rows, menus and bulk bar, the
 * editor, the shared fields and pickers, and the messages about saving and deleting entries.
 */
export const entries = {
  /** The toast after saving a finished entry, with the duration the server stored. */
  added: 'Added {duration}',
  duplicated: 'Entry duplicated',
  deleted: 'Entry deleted',
  splitDone: 'Entry split in two',
  pinned: 'Pinned to favorites',
  favoritesFull: 'You can pin up to {max} favorites',
  /** A number of entries, as in "2 entries deleted, 1 entry failed". */
  count: { one: '{count} entry', other: '{count} entries' },
  /** Several entries deleted at once. */
  deletedMany: { one: '{count} entry deleted', other: '{count} entries deleted' },
  /** The English wording says "entries" even for one; the plural forms keep that. */
  failedMany: { one: '{count} entries failed: {reason}', other: '{count} entries failed: {reason}' },
  partlyDeleted: '{deleted} deleted, {failed} failed: {reason}',
  checkTimes: 'Check the start and end times',
  checkDuration: 'Check the duration',
  durationUnreadable: 'Enter a duration like 1:30 or 90m',
  durationRoundsToZero: 'The duration rounds to zero at the {resolution}-minute time resolution',
  durationTooLong: 'No-time entries can be at most 24 hours',

  periodToday: 'Today',
  periodWeek: 'This week',
  view: 'View',
  viewList: 'List',
  viewCalendar: 'Calendar',
  shortcuts: 'Shortcuts',
  favorites: 'Favorites',
  favoriteUntitled: 'Untitled',
  favoriteStart: 'Start ({number})',
  favoriteName: '{name}, {project}',
  removeFavorite: 'Remove favorite',
  loadingEntries: 'Loading entries…',
  loadFailed: 'Could not load time entries: {message}',
  showMoreDays: { one: 'Show {count} more day', other: 'Show {count} more days' },

  emptyTitle: 'No time entries in this period',
  emptyStartTimer: 'Start timer',
  emptyManualMode: 'Manual mode',
  emptyHintManual: 'Start the timer when you paddle out, or switch to manual mode to log time you already worked.',
  emptyHintTimes: 'Start the timer when you paddle out, or fill in the times above to log time you already worked.',
  selectDay: 'Select all entries of this day',
  showEntries: 'Show entries',

  selectEntry: 'Select entry',
  addDescription: 'Add description',
  description: 'Description',
  project: 'Project',
  tags: 'Tags',
  billable: 'Billable',
  editTimes: 'Edit times',
  overlaps: 'Overlaps another entry',
  continue: 'Continue this entry',
  moreActions: 'More actions',

  menuLabel: 'Entry actions',
  edit: 'Edit',
  duplicate: 'Duplicate',
  pin: 'Pin as favorite',
  /** The menu's delete for a group of several entries. */
  deleteCount: { one: 'Delete {count} entry', other: 'Delete {count} entries' },

  bulkLabel: 'Bulk actions',
  bulkSelected: { one: '{count} selected', other: '{count} selected' },
  bulkAddTags: 'Add tags',
  bulkNonBillable: 'Non-billable',
  bulkClear: 'Clear',
  bulkMarkedBillable: 'Marked billable',
  bulkMarkedNonBillable: 'Marked non-billable',
  bulkProjectUpdated: 'Project updated',
  bulkTagsAdded: 'Tags added',

  suggestions: 'Suggestions',
  noDescription: '(no description)',
  projectTitle: 'Project (@)',
  tagsTitle: 'Tags (#)',
  unknownProject: 'Unknown project',
  projectWithTask: '{project}: {task}',

  pickerProjectLabel: 'Project and task',
  pickerProjectSearch: 'Find or create project…',
  pickerProjects: 'Projects',
  noProject: 'No project',
  createProject: 'Create project "{name}"',
  noProjectsYet: 'No projects yet. Type a name to create one.',
  pickerTagSearch: 'Find or create tags…',
  createTag: 'Create tag "{name}"',
  noTagsYet: 'No tags yet. Type a name to create one.',

  editRunning: 'Edit running entry',
  editEntry: 'Edit entry',
  noTags: 'No tags',
  billableProjectDefault: 'Billable (project default)',
  noTimes: 'No times',
  date: 'Date',
  duration: 'Duration',
  start: 'Start',
  end: 'End',
  endsNextDay: 'Ends the next day, {day}.',

  splitUnreadable: 'Enter a split time like 10:30',
  splitOutside: 'The split time must fall inside the entry',
  splitAt: 'Split at',
  splitPlaceholder: 'e.g. 10:30',
  split: 'Split',
  splitsInto: 'Splits into {first} and {second}.',
} as const satisfies MessageGroup;
