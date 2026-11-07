/**
 * What a client asks of a time entry, already parsed: `commands/timeEntries.ts` builds these from
 * request bodies and import rows. Each optional field is absent when the client did not send it.
 */
import type { ApplicationError } from '../lib/errors.ts';
import type { Id } from '../storage/domain.ts';

export const MAX_DESCRIPTION_LENGTH = 3000;
export const MAX_CREATED_WITH_LENGTH = 255;

/** The times a client sent. Which of them apply depends on the entry and on `all_day`. */
export interface EntryTimes {
  start?: Date;
  /** `start` moved to `startDate`, keeping its clock time and offset. Set when both were sent. */
  startOnDate?: Date;
  /** YYYY-MM-DD: the day of a no-time entry, or the date part of `start`. */
  startDate?: string;
  stop?: Date;
  /** Whole seconds; negative means running. */
  duration?: number;
}

/** How `tagIds` and `tagNames` combine with an entry's tags. */
export type TagAction = 'add' | 'delete' | 'replace';

export interface EntryFields {
  /** The workspace the body names, which must be the URL's. `null` names none. */
  workspaceId?: Id | null;
  /** `null` clears the project. */
  projectId?: Id | null;
  /** `null` clears the task. */
  taskId?: Id | null;
  description?: string;
  billable?: boolean;
  tagIds?: Id[];
  /** Tags by name; missing ones are created. */
  tagNames?: string[];
}

export interface NewEntry extends EntryFields {
  allDay: boolean;
  times: EntryTimes;
  createdWith?: string;
}

/** Where to split a stopped entry in two. */
export interface EntrySplit {
  /** The cut. It moves to the nearest grid point of the time resolution, as a stop does. */
  at: Date;
  /** The `created_with` of the new second half. */
  createdWith?: string;
}

export interface EntryChanges extends EntryFields {
  allDay?: boolean;
  times: EntryTimes;
  tagAction: TagAction;
}

/**
 * One JSON Patch operation of a bulk edit, applied to each listed entry in turn. A refusal fails
 * only that entry. A malformed operation or an unsupported path is refused before the entry is
 * read; a refused value is reported once the entry is found, so a missing entry says so.
 */
export interface EntryPatchStep {
  /** `/start` or `/stop`, which a no-time entry does not have. */
  touchesTimes: boolean;
  edit: { ok: true; changes: EntryChanges } | { ok: false; error: ApplicationError; afterLookup: boolean };
}
