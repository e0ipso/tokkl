import type { PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { PomodoroLimits, Preferences } from '@tokkl/types';
import type { MessageKey } from '../i18n/messages.ts';

/** Labels and units are catalog keys; `limit` names the server's `pomodoro_limits` entry. */
export const POMODORO_FIELDS = [
  {
    key: 'workMinutes',
    limit: 'work_minutes',
    preference: 'pomodoro_focus_interval_in_minutes',
    label: 'pomodoro.lengthWork',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'shortRestMinutes',
    limit: 'short_rest_minutes',
    preference: 'pomodoro_break_interval_in_minutes',
    label: 'pomodoro.lengthShortRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestMinutes',
    limit: 'long_rest_minutes',
    preference: 'pomodoro_long_break_interval_in_minutes',
    label: 'pomodoro.lengthLongRest',
    unit: 'pomodoro.unitMinutes',
    spokenUnit: 'pomodoro.spokenMinutes',
  },
  {
    key: 'longRestEvery',
    limit: 'long_rest_every',
    preference: 'pomodoro_long_break_every',
    label: 'pomodoro.lengthLongRestEvery',
    unit: 'pomodoro.unitPomodoros',
    spokenUnit: 'pomodoro.spokenPomodoros',
  },
] as const satisfies ReadonlyArray<{
  key: keyof PomodoroSessionConfig;
  limit: keyof PomodoroLimits;
  preference: keyof Preferences;
  label: MessageKey;
  unit: MessageKey;
  spokenUnit: MessageKey;
}>;
