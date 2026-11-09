import type { TimeEntry } from '@tokkl/types';
import { draftOf, editsSince, type EntryDraft } from './useEntryFields.ts';

/** A timer this bar started, remembered until it first loads as the running entry. */
export interface OwnStart {
  /** The start, in whole seconds as the server stores it, in ms since the epoch. */
  startMs: number;
  /** The draft the timer started from. */
  base: EntryDraft;
}

/** What the timer bar's draft knows when the running entry changes. */
export interface RunningDraftState {
  current: TimeEntry | null;
  /** The entry the draft mirrors, or null when it mirrors none. */
  shownEntryId: number | null;
  ownStart: OwnStart | null;
  draft: EntryDraft;
  /** Whether the description field has focus. */
  typing: boolean;
}

/** How the draft follows the running entry. */
export type RunningDraftStep =
  /** No entry runs and none was shown: nothing to do. */
  | { kind: 'idle' }
  /** The shown entry stopped: the draft goes back to empty. */
  | { kind: 'clear' }
  /** This bar's own start loaded: the draft takes the entry plus what was typed since Start, which must be saved. */
  | { kind: 'adopt'; entryId: number; draft: EntryDraft; edits: Partial<EntryDraft> }
  /**
   * The draft mirrors the entry. `keepDescription` keeps a description still being typed into the
   * shown entry; `forgetOwnStart` drops a remembered start that turned out to be another entry.
   */
  | { kind: 'mirror'; entryId: number; draft: EntryDraft; keepDescription: boolean; forgetOwnStart: boolean };

/** Decides how the timer bar's draft follows the running entry (see useRunningDraft). */
export function followRunningEntry({
  current,
  shownEntryId,
  ownStart,
  draft,
  typing,
}: RunningDraftState): RunningDraftStep {
  if (!current) return shownEntryId === null ? { kind: 'idle' } : { kind: 'clear' };
  const newEntry = current.id !== shownEntryId;
  if (ownStart && newEntry && Date.parse(current.start) === ownStart.startMs) {
    const edits = editsSince(ownStart.base, draft);
    return { kind: 'adopt', entryId: current.id, draft: { ...draftOf(current), ...edits }, edits };
  }
  return {
    kind: 'mirror',
    entryId: current.id,
    draft: draftOf(current),
    keepDescription: !newEntry && typing,
    forgetOwnStart: ownStart !== null && newEntry,
  };
}
