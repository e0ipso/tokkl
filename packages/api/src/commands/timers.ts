/** Timer action bodies, parsed into commands. */
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

/**
 * The actions that still take a body without `revision`, each with the capability that announced
 * the revision check. A client that sends a revision is refused when the timer moved on; a body
 * without one acts on whatever runs, so clients from before the capability keep working.
 *
 * The minimum client is one that sends `revision` on every action named here, which a client does
 * once it relies on these capabilities. When every supported client does, a release can require
 * the revision: parse it with `parseRevision` in `parseStartPomodoro` and `parsePauseTimer`, make
 * it required in `StartPomodoro` and `TimerOperations.pauseTimer`, and remove this table. The
 * capabilities stay announced, since clients probe them.
 */
export const OPTIONAL_REVISION_ACTIONS = Object.freeze({
  'POST /api/app/pomodoro': 'pomodoro-revision',
  'POST /api/app/timer/pause': 'pause-revision',
} as const satisfies Record<string, ServerCapability>);

/** The `revision` of an action in `OPTIONAL_REVISION_ACTIONS`; undefined when the body has none. */
function optionalRevision(body: JsonBody, _action: keyof typeof OPTIONAL_REVISION_ACTIONS): number | undefined {
  return body.revision == null ? undefined : parseRevision(body.revision);
}

/** A session start; see `OPTIONAL_REVISION_ACTIONS` for its optional revision. */
export function parseStartPomodoro(body: JsonBody): StartPomodoro {
  return {
    revision: optionalRevision(body, 'POST /api/app/pomodoro'),
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

/** An optional instant field; absent and null both mean now. */
const optionalInstant = (value: unknown, field: string): Date | undefined =>
  value == null ? undefined : parseInstant(value, field);

/** A timer start: the revision the client saw, the entry's labels, and an optional `start` instant. */
export function parseStartTimer(body: JsonBody): StartTimer {
  return {
    revision: parseRevision(body.revision),
    workspaceId: optionalId(body.workspace_id, 'workspace_id'),
    start: optionalInstant(body.start, 'start'),
    entry: parseEntryLabels(body),
  };
}

/** A timer stop: the revision the client saw and an optional `stop` instant. */
export function parseStopTimer(body: JsonBody): { revision: number; stop?: Date } {
  return { revision: parseRevision(body.revision), stop: optionalInstant(body.stop, 'stop') };
}

/** A pause; see `OPTIONAL_REVISION_ACTIONS` for its optional revision. Older clients send no body. */
export function parsePauseTimer(body: JsonBody): { revision?: number } {
  return { revision: optionalRevision(body, 'POST /api/app/timer/pause') };
}

/** The id of the entry the client saw running. */
function optionalEntryId(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw invalidInput('Invalid entry_id: expected a positive integer');
  return value;
}

/**
 * A running timer edit: what the client saw, the labels to change and an optional new `start`.
 * The client names what it saw by `revision`, by `entry_id` (the entry it edits is still the
 * running one), or by both. A body with neither is refused as a missing revision.
 */
export function parseEditTimer(body: JsonBody): EditTimer {
  const entryId = optionalEntryId(body.entry_id);
  const changes = { start: optionalInstant(body.start, 'start'), entry: parseLabelChanges(body) };
  if (entryId !== undefined && body.revision == null) return { entryId, ...changes };
  return { revision: parseRevision(body.revision), entryId, ...changes };
}
