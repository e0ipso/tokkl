import {
  DEFAULT_POMODORO_SESSION_CONFIG,
  POMODORO_SESSION_CONFIG_RANGES,
  type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { PomodoroLimits, ServerApi, ServerCapability } from '@tokkl/types';

const CAPABILITIES: readonly ServerCapability[] = Object.freeze([
  'app-preferences',
  'timer-actions',
  'timer-edit',
  'pomodoro-revision',
  'pause-revision',
  'timer-edit-entry',
  'idempotency-keys',
  'catalog-revision',
  'latest-entry',
]);

/** Fresh on each call, so no reply shares an array another one could change. */
export function presentServerApi(): ServerApi {
  return { api_version: 1, capabilities: [...CAPABILITIES] };
}

/** So clients stop copying them. Fresh on each call. */
export function presentPomodoroLimits(): PomodoroLimits {
  const limit = (key: keyof PomodoroSessionConfig) => ({
    ...POMODORO_SESSION_CONFIG_RANGES[key],
    default: DEFAULT_POMODORO_SESSION_CONFIG[key],
  });
  return {
    work_minutes: limit('workMinutes'),
    short_rest_minutes: limit('shortRestMinutes'),
    long_rest_minutes: limit('longRestMinutes'),
    long_rest_every: limit('longRestEvery'),
  };
}
