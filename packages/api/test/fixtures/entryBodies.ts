/**
 * The time entry and timer operations as a request reaches them: each raw body is parsed by the
 * same command parser the routes use, then handed to the domain. Domain tests keep their bodies.
 */
import { parseEntryChanges, parseEntryPatch, parseNewEntry, parseStopAt } from '../../src/commands/timeEntries.ts';
import { parseRevision, parseStartPomodoro } from '../../src/commands/timers.ts';
import * as domain from '../../src/domain/timeEntries.ts';
import type { EntryContext } from '../../src/domain/entryAccess.ts';
import type { ExactEntryImport } from '../../src/domain/entryImport.ts';
import type { TimerPublication } from '../../src/domain/timerSettlement.ts';
import type { PresentedTimerOperations } from '../../src/services/timerReplies.ts';
import type { User } from '../../src/domain/model.ts';
import type { Clock } from '../../src/domain/ports.ts';
import type { EditTimer, StartPomodoro, StartTimer } from '../../src/domain/timers.ts';
import { systemClock } from '../../src/lib/clock.ts';
import { fixedClock } from './clock.ts';

export * from '../../src/domain/timeEntries.ts';
export { getTimeEntry, protectEntryOperation } from '../../src/domain/entryAccess.ts';
export { entryDurationSeconds, noTimeSpan } from '../../src/domain/entrySpans.ts';
export { withExactEntryImport, type ExactEntryImport } from '../../src/domain/entryImport.ts';

type Body = Record<string, unknown>;

export const createTimeEntry = async (
  ctx: EntryContext,
  seen: User,
  wid: number,
  body: Body,
  publish: TimerPublication,
  options?: domain.CreateOptions,
) => domain.createTimeEntry(ctx, seen, wid, parseNewEntry(body), publish, options);

export const updateTimeEntry = async (
  ctx: EntryContext,
  seen: User,
  wid: number,
  id: number,
  body: Body,
  publish: TimerPublication,
) => domain.updateTimeEntry(ctx, seen, wid, id, parseEntryChanges(body), publish);

export const stopTimeEntry = async (
  ctx: EntryContext,
  seen: User,
  wid: number,
  id: number,
  publish: TimerPublication,
  stop?: unknown,
) => domain.stopTimeEntry(ctx, seen, wid, id, publish, parseStopAt(stop === undefined ? undefined : { stop }));

export const patchTimeEntries = async (
  ctx: EntryContext,
  seen: User,
  wid: number,
  ids: number[],
  operations: unknown[],
  publish: TimerPublication,
) => domain.patchTimeEntries(ctx, seen, wid, ids, parseEntryPatch(operations), publish);

/** An import writer that takes raw entry bodies, as the importers build them. */
export const bodyWriter = (writer: ExactEntryImport) => ({
  savepoint: writer.savepoint,
  create: async (body: Body) => writer.create(parseNewEntry(body)),
});

type Timers = PresentedTimerOperations;
/** Builds one user's timer operations on `clock`. */
type TimersFor = (userId: number, clock: Clock) => Timers;

/**
 * Timer operations that take the user's id first and an optional time last. Each call builds
 * `forUser(userId, clock)` on a clock fixed at that time, or on the system clock without one.
 */
export function timersById(forUser: TimersFor) {
  const at = (userId: number, now: Date | undefined) => forUser(userId, now ? fixedClock(now) : systemClock);
  return {
    getTimerState: (userId: number, now?: Date) => at(userId, now).getTimerState(),
    startTimer: (userId: number, start: StartTimer, now?: Date) => at(userId, now).startTimer(start),
    stopTimer: (userId: number, revision: number, stop?: Date, now?: Date) => at(userId, now).stopTimer(revision, stop),
    editTimer: (userId: number, edit: EditTimer, now?: Date) => at(userId, now).editTimer(edit),
    startPomodoro: (userId: number, start: StartPomodoro, now?: Date) => at(userId, now).startPomodoro(start),
    nextPomodoroPhase: (userId: number, revision: number, now?: Date) => at(userId, now).nextPomodoroPhase(revision),
    endPomodoro: (userId: number, revision: number, now?: Date) => at(userId, now).endPomodoro(revision),
    pauseTimer: (userId: number, revision: number | undefined, now?: Date) => at(userId, now).pauseTimer(revision),
    resumeTimer: (userId: number, revision: number, now?: Date) => at(userId, now).resumeTimer(revision),
    discardPause: (userId: number, revision: number, now?: Date) => at(userId, now).discardPause(revision),
  };
}

/** `timersById` that takes a raw Pomodoro body and an unchecked revision. */
export function bodyTimers(forUser: TimersFor) {
  const timers = timersById(forUser);
  return {
    ...timers,
    startPomodoro: async (userId: number, body: Body, now?: Date) =>
      timers.startPomodoro(userId, parseStartPomodoro(body), now),
    nextPomodoroPhase: async (userId: number, revision: unknown, now?: Date) =>
      timers.nextPomodoroPhase(userId, parseRevision(revision), now),
    endPomodoro: async (userId: number, revision: unknown, now?: Date) =>
      timers.endPomodoro(userId, parseRevision(revision), now),
    resumeTimer: async (userId: number, revision: unknown, now?: Date) =>
      timers.resumeTimer(userId, parseRevision(revision), now),
    discardPause: async (userId: number, revision: unknown, now?: Date) =>
      timers.discardPause(userId, parseRevision(revision), now),
  };
}
