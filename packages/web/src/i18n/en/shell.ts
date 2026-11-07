import type { MessageGroup } from '../catalog.ts';

/** The app frame: navigation, the More sheet, the tab title and app-wide load errors. */
export const shell = {
  appName: 'Tokkl',
  navLabel: 'Main',
  navTimer: 'Timer',
  navPomodoro: 'Pomodoro',
  navReports: 'Reports',
  navProjects: 'Projects',
  navClients: 'Clients',
  navTags: 'Tags',
  navTrash: 'Trash',
  navAdmin: 'Admin',
  navSettings: 'Settings',
  more: 'More',
  logOut: 'Log out',
  logOutFailed: 'Log out failed. You are still signed in.',
  version: 'Version {version}',
  signedInAs: 'Signed in as ',
  timerRunning: 'Timer running',
  sessionRunning: 'Pomodoro session running',
  /** The tab title while a timer runs: its elapsed time and description. */
  runningTitle: '{duration} · {description}',
  /** The tab title's description for a running entry without one. */
  runningUntitled: 'Running',
  serverUnreachable: "Can't reach the server: {message}",
  pageBroke: 'Something broke on this page',
} as const satisfies MessageGroup;
