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
/** One user's timer operations with that user's id as the first argument of each. */
export type TimersById = {
  [Name in keyof Timers]: (userId: number, ...args: Parameters<Timers[Name]>) => ReturnType<Timers[Name]>;
};

/** Timer operations that take the user's id first and build `forUser(userId)` for each call. */
export function timersById(forUser: (userId: number) => Timers): TimersById {
  const names = Object.keys(forUser(0)) as (keyof Timers)[];
  return Object.fromEntries(
    names.map(name => [
      name,
      (userId: number, ...args: unknown[]) => (forUser(userId)[name] as (...rest: unknown[]) => unknown)(...args),
    ]),
  ) as TimersById;
}

/** Timer operations by user id that take a raw Pomodoro body and an unchecked revision. */
export function bodyTimers(forUser: (userId: number) => Timers) {
  return {
    ...timersById(forUser),
    startPomodoro: async (userId: number, body: Body, now?: Date) =>
      forUser(userId).startPomodoro(parseStartPomodoro(body), now),
    nextPomodoroPhase: async (userId: number, revision: unknown, now?: Date) =>
      forUser(userId).nextPomodoroPhase(parseRevision(revision), now),
    endPomodoro: async (userId: number, revision: unknown, now?: Date) =>
      forUser(userId).endPomodoro(parseRevision(revision), now),
    resumeTimer: async (userId: number, revision: unknown, now?: Date) =>
      forUser(userId).resumeTimer(parseRevision(revision), now),
    discardPause: async (userId: number, revision: unknown, now?: Date) =>
      forUser(userId).discardPause(parseRevision(revision), now),
  };
}
