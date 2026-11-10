import type { MessageGroup } from '../catalog.ts';

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
  runningTitle: '{duration} · {description}',
  /** For a running entry without a description. */
  runningUntitled: 'Running',
  serverUnreachable: "Can't reach the server: {message}",
  pageBroke: 'Something broke on this page',
} as const satisfies MessageGroup;
