import type { TimeEntry } from '@tokkl/types';
import { draftOf, editsSince, type EntryDraft } from './useEntryFields.ts';

export interface OwnStart {
  /** Whole seconds, as the server stores it. */
  startMs: number;
  base: EntryDraft;
}

export interface RunningDraftState {
  current: TimeEntry | null;
  shownEntryId: number | null;
  ownStart: OwnStart | null;
  draft: EntryDraft;
  typing: boolean;
}

type RunningDraftStep =
  | { kind: 'idle' }
  | { kind: 'clear' }
  /** The draft takes the entry plus what was typed since Start, which must be saved. */
  | { kind: 'adopt'; entryId: number; draft: EntryDraft; edits: Partial<EntryDraft> }
  /** `keepDescription` keeps a description still being typed; `forgetOwnStart` drops a start that was another entry. */
  | { kind: 'mirror'; entryId: number; draft: EntryDraft; keepDescription: boolean; forgetOwnStart: boolean };

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
