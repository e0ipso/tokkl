/** Parsed client requests. An optional field is absent when the client did not send it. */
import type { ApplicationError } from '../lib/errors.ts';
import type { Id } from './model.ts';

export const MAX_DESCRIPTION_LENGTH = 3000;
export const MAX_CREATED_WITH_LENGTH = 255;

/** Which apply depends on the entry and on `all_day`. */
export interface EntryTimes {
  start?: Date;
  /** Keeps its clock time and offset. Set when both were sent. */
  startOnDate?: Date;
  /** YYYY-MM-DD: the day of a no-time entry, or the date part of `start`. */
  startDate?: string;
  stop?: Date;
  /** Whole seconds; negative means running. */
  duration?: number;
}

export type TagAction = 'add' | 'delete' | 'replace';

export interface EntryFields {
  /** Must match the URL's. `null` names none. */
  workspaceId?: Id | null;
  /** `null` clears the project. */
  projectId?: Id | null;
  /** `null` clears the task. */
  taskId?: Id | null;
  description?: string;
  billable?: boolean;
  tagIds?: Id[];
  /** Missing ones are created. */
  tagNames?: string[];
}

export interface NewEntry extends EntryFields {
  allDay: boolean;
  times: EntryTimes;
  createdWith?: string;
}

export interface EntrySplit {
  /** Moves to the nearest grid point, as a stop does. */
  at: Date;
  createdWith?: string;
}

export interface EntryChanges extends EntryFields {
  allDay?: boolean;
  times: EntryTimes;
  tagAction: TagAction;
}

/** A refusal fails only that entry; value refusals come after the read, so a missing entry says so. */
export interface EntryPatchStep {
  /** `/start` or `/stop`, which a no-time entry does not have. */
  touchesTimes: boolean;
  edit: { ok: true; changes: EntryChanges } | { ok: false; error: ApplicationError; afterLookup: boolean };
}
