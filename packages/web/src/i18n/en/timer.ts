import type { MessageGroup } from '../catalog.ts';

export const timer = {
  region: 'Timer',
  running: 'Running',
  paused: 'Paused',
  duration: 'Duration',
  placeholderManual: 'What did you work on?',
  placeholderIdle: 'What are you working on?',
  placeholderRunning: 'Add a description',
  announcePaused: 'Timer paused',
  announceResumed: 'Timer resumed',

  addEntry: 'Add entry',
  add: 'Add',
  saveEntry: 'Save entry',
  startTimer: 'Start timer',
  startTitle: 'Start (N)',
  start: 'Start',
  pauseTimer: 'Pause timer',
  pause: 'Pause',
  resumeTimer: 'Resume timer',
  resume: 'Resume',
  stopTimer: 'Stop timer',
  stopTitle: 'Stop (S)',
  stop: 'Stop',
  entryMode: 'Entry mode',
  discardRunning: 'Discard running entry',
  timerMode: 'Timer mode',
  manualMode: 'Manual mode',
  manualModeTitle: 'Manual mode (M)',

  clockPaused: '{elapsed} elapsed, paused',
  clockEdit: '{elapsed} elapsed, edit start time',
  editStartTime: 'Edit start time',

  checkDuration: 'Check the duration',
  tooShort: 'Too short to keep, so the entry went to the trash',
  runningDiscarded: 'Running entry discarded',
  conflict: 'Another device changed the timer first.',
  offline: "Can't reach the server. Try again when you're back online.",
  unreadableState: 'The server sent an unreadable timer state.',

  manualStartEnd: 'Enter a start and end time, like 9:00 and 10:30',
  noTimes: 'No times',
  date: 'Date',
  startTime: 'Start time',
  startPlaceholder: 'Start',
  endTime: 'End time',
  endPlaceholder: 'End',
  nextDay: '+1 day',

  reminderLabel: 'Long-running timer reminder',
  reminderText: {
    one: 'Your timer has been running for more than {count} hour. Is it still running on purpose?',
    other: 'Your timer has been running for more than {count} hours. Is it still running on purpose?',
  },
  reminderKeep: 'Keep running',
  reminderReview: 'Review timer',
  reminderNotificationTitle: 'Is your timer still running on purpose?',
  reminderNotificationBody: {
    one: 'Your timer has been running for more than {count} hour. Open Tokkl to confirm or review it.',
    other: 'Your timer has been running for more than {count} hours. Open Tokkl to confirm or review it.',
  },

  allowNotifications: 'Allow notifications',
  notificationsDefault:
    'Shows a notification when a phase ends while Tokkl is in a background tab, or when a long-running timer needs checking.',
  notificationsGranted:
    'Notifications are allowed. Tokkl shows them for Pomodoro phases and long-running timer reminders while Tokkl is in a background tab.',
  notificationsDenied:
    "Notifications are blocked. Allow them in the browser's site settings to get timer reminders and Pomodoro notifications in a background tab.",
  notificationsInsecure:
    'Notifications need HTTPS. Open Tokkl over HTTPS to get timer reminders and Pomodoro notifications in a background tab.',
  notificationsUnsupported: "This browser can't show notifications.",
  phaseOverTitle: '{phase} phase over',
  phaseOverBody: 'Choose Next phase or End session in Tokkl.',

  shortcutsTitle: 'Keyboard shortcuts',
  shortcutNew: 'Start a new timer',
  shortcutStop: 'Stop the running timer',
  shortcutContinue: 'Continue the most recent entry',
  shortcutMode: 'Switch between timer and manual mode',
  shortcutFavorite: 'Start a pinned favorite',
  shortcutPickers: 'Pick project / tags from an empty description',
  shortcutCreate: 'Create the project or tag typed in a picker',
  shortcutHelp: 'Show this list',
} as const satisfies MessageGroup;
