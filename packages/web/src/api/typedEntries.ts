import type { QueryClient } from '@tanstack/react-query';
import { dateKey } from '@tokkl/common/time';
import type { SnappedSpan } from '@tokkl/common/snap';
import { storedSpan } from '../lib/snapping.ts';
import type { Settings } from '../lib/settings.ts';
import { attemptTimerRequest } from './timerHooks.ts';
import { explainTimerActionError, isOutcomeUnknown } from './timerState.ts';
import type { TimeEntry, TimeEntryInput } from './types.ts';

/** A finished entry typed into the idle timer bar: the draft's fields and the span it covers. */
export type TypedEntryInput = TimeEntryInput & { start: string; stop: string };

/** What a typed-entry create stores, as far as telling whether it landed needs. */
export interface TypedEntryMatch {
  description: string;
  project_id: number | null;
  /** The span the server stores for the sent one (`storedSpan`). */
  span: SnappedSpan;
}

const sameInstant = (stored: string | null, expected: Date) =>
  stored !== null && Date.parse(stored) === expected.getTime();

/**
 * The entry that a typed-entry create stored although its reply was lost, or null when it did not
 * land as far as `after` shows. It is an entry of `after`, read once the create failed, that was not
 * in `before`, read before the create went out, and has the stored span, description and project
 * sent. An identical entry that was already there does not count, so adding the same duration twice
 * on purpose is never taken for a landed retry.
 */
export function landedTypedEntry(
  before: readonly TimeEntry[],
  after: readonly TimeEntry[],
  match: TypedEntryMatch,
): TimeEntry | null {
  const existing = new Set(before.map(entry => entry.id));
  return (
    after.find(
      entry =>
        !existing.has(entry.id) &&
        entry.description === match.description &&
        entry.project_id === match.project_id &&
        sameInstant(entry.start, match.span.start) &&
        sameInstant(entry.stop, match.span.stop),
    ) ?? null
  );
}

/** How a typed entry reaches the server: its create, and the read of one day's entries. */
export interface TypedEntryRequests {
  create(input: TypedEntryInput): Promise<TimeEntry>;
  /** Entries that started on `day`, "YYYY-MM-DD" in the account timezone. */
  day(day: string): Promise<TimeEntry[]>;
}

/**
 * Saves a typed entry as a timer write (`attemptTimerRequest`). A finished entry does not move the
 * timer revision, so the reconciling read cannot tell whether a create whose reply was lost landed,
 * and sending it again could store it twice. The entries of the day it starts on are read first;
 * when the create fails with an unknown outcome (`isOutcomeUnknown`), they are read again, and an
 * entry that matches it and was not there before is taken as the stored one. Otherwise the create
 * fails as before, and so does a read that fails: the first one with the error a create would show,
 * the second one with the create's own error. A span too short to store goes out unguarded, for
 * the server to refuse.
 *
 * A create whose deadline passed may still land after the second read; that case stays open.
 */
export async function addTypedEntry(
  qc: QueryClient,
  requests: TypedEntryRequests,
  input: TypedEntryInput,
  settings: Pick<Settings, 'timeZone' | 'timeResolution'>,
): Promise<TimeEntry> {
  const span = storedSpan(new Date(input.start), new Date(input.stop), settings);
  if (!span) return attemptTimerRequest(qc, () => requests.create(input));
  const day = dateKey(span.start, settings.timeZone);
  const before = await requests.day(day).catch((error: unknown) => {
    throw explainTimerActionError(error);
  });
  const match = { description: input.description ?? '', project_id: input.project_id ?? null, span };
  return attemptTimerRequest(qc, async () => {
    try {
      return await requests.create(input);
    } catch (error) {
      if (!isOutcomeUnknown(error)) throw error;
      const landed = await requests.day(day).then(
        after => landedTypedEntry(before, after, match),
        () => null,
      );
      if (landed) return landed;
      throw error;
    }
  });
}
