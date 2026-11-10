import { admin } from './admin.ts';
import { api } from './api.ts';
import { auth } from './auth.ts';
import { calendar } from './calendar.ts';
import { common } from './common.ts';
import { dates } from './dates.ts';
import { entries } from './entries.ts';
import { manage } from './manage.ts';
import { pomodoro } from './pomodoro.ts';
import { reports } from './reports.ts';
import { settings } from './settings.ts';
import { shell } from './shell.ts';
import { timer } from './timer.ts';

/** The catalog every other language translates. Keys name the feature and the message: `t('timer.start')`. */
export const en = {
  common,
  dates,
  shell,
  timer,
  entries,
  calendar,
  pomodoro,
  reports,
  manage,
  settings,
  admin,
  auth,
  api,
} as const;
