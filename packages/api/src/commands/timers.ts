/** Timer action bodies, parsed into commands. */
import { POMODORO_SESSION_CONFIG_RANGES, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { StartPomodoro } from '../domain/timers.ts';
import { invalidInput } from '../lib/errors.ts';
import { optionalId, type JsonBody } from '../lib/values.ts';
import { parseEntryLabels } from './timeEntries.ts';

const LENGTH_FIELDS = {
  workMinutes: 'work_minutes',
  shortRestMinutes: 'short_rest_minutes',
  longRestMinutes: 'long_rest_minutes',
  longRestEvery: 'long_rest_every',
} as const satisfies Record<keyof PomodoroSessionConfig, string>;

function readLengths(body: JsonBody): Partial<PomodoroSessionConfig> {
  const lengths: Partial<PomodoroSessionConfig> = {};
  for (const key of Object.keys(LENGTH_FIELDS) as Array<keyof PomodoroSessionConfig>) {
    const field = LENGTH_FIELDS[key],
      value = body[field];
    if (value == null) continue;
    const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      throw invalidInput(`Invalid ${field}: expected an integer from ${min} to ${max}`);
    lengths[key] = value;
  }
  return lengths;
}

export function parseStartPomodoro(body: JsonBody): StartPomodoro {
  return {
    workspaceId: optionalId(body.workspace_id, 'workspace_id'),
    lengths: readLengths(body),
    entry: parseEntryLabels(body),
  };
}

/** The timer revision the client last saw. Timer actions refuse to act on a newer one. */
export function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw invalidInput('Invalid revision: expected an integer');
  return value;
}
