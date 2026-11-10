import { POMODORO_SESSION_CONFIG_RANGES, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { PomodoroLimits, ServerCapability } from '@tokkl/types';
import type { EditTimer, StartPomodoro, StartTimer } from '../domain/timers.ts';
import { invalidInput } from '../lib/errors.ts';
import { optionalId, parseInstant, type JsonBody } from '../lib/values.ts';
import { parseEntryLabels, parseLabelChanges } from './timeEntries.ts';

const LENGTH_FIELDS = {
  workMinutes: 'work_minutes',
  shortRestMinutes: 'short_rest_minutes',
  longRestMinutes: 'long_rest_minutes',
  longRestEvery: 'long_rest_every',
} as const satisfies Record<keyof PomodoroSessionConfig, keyof PomodoroLimits>;

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

/** Actions older clients may send without `revision`; without one they act on whatever runs. */
export const OPTIONAL_REVISION_ACTIONS = Object.freeze({
  'POST /api/app/pomodoro': 'pomodoro-revision',
  'POST /api/app/timer/pause': 'pause-revision',
} as const satisfies Record<string, ServerCapability>);

export type OptionalRevisionAction = keyof typeof OPTIONAL_REVISION_ACTIONS;

function optionalRevision(body: JsonBody): number | undefined {
  return body.revision == null ? undefined : parseRevision(body.revision);
}

/** Revision optional: see `OPTIONAL_REVISION_ACTIONS`. */
export function parseStartPomodoro(body: JsonBody): StartPomodoro {
  return {
    revision: optionalRevision(body),
    workspaceId: optionalId(body.workspace_id, 'workspace_id'),
    lengths: readLengths(body),
    entry: parseEntryLabels(body),
  };
}

/** Timer actions refuse when the timer has moved past it. */
export function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw invalidInput('Invalid revision: expected an integer');
  return value;
}

/** Absent and null both mean now. */
const optionalInstant = (value: unknown, field: string): Date | undefined =>
  value == null ? undefined : parseInstant(value, field);

export function parseStartTimer(body: JsonBody): StartTimer {
  return {
    revision: parseRevision(body.revision),
    workspaceId: optionalId(body.workspace_id, 'workspace_id'),
    start: optionalInstant(body.start, 'start'),
    entry: parseEntryLabels(body),
  };
}

export function parseStopTimer(body: JsonBody): { revision: number; stop?: Date } {
  return { revision: parseRevision(body.revision), stop: optionalInstant(body.stop, 'stop') };
}

/** Revision optional: see `OPTIONAL_REVISION_ACTIONS`. Older clients send no body. */
export function parsePauseTimer(body: JsonBody): { revision?: number } {
  return { revision: optionalRevision(body) };
}

function optionalEntryId(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw invalidInput('Invalid entry_id: expected a positive integer');
  return value;
}

/** Names what the client saw by `revision`, `entry_id` (still running) or both; neither is a missing revision. */
export function parseEditTimer(body: JsonBody): EditTimer {
  const entryId = optionalEntryId(body.entry_id);
  const changes = { start: optionalInstant(body.start, 'start'), entry: parseLabelChanges(body) };
  if (entryId !== undefined && body.revision == null) return { entryId, ...changes };
  return { revision: parseRevision(body.revision), entryId, ...changes };
}
