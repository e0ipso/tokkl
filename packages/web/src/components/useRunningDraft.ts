import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { useUpdateRunningEntry } from '../api/entries.ts';
import type { RunningEntryChanges } from '../api/timerHooks.ts';
import type { TimeEntry } from '../api/types.ts';
import type { EntryFieldsHandle } from './EntryFields.tsx';
import { useToast } from './Toast.tsx';
import { followRunningEntry, type OwnStart } from './runningDraftSync.ts';
import { EMPTY_DRAFT, draftSignature, type EntryDraft } from './useEntryFields.ts';

/**
 * The timer bar's draft. While a timer runs, the draft mirrors that entry; when it stops (here or
 * on another device), the draft goes back to empty. Only this hook resets the draft after a start
 * or stop, so a refetch that lands before the mutation settles cannot wipe what the user typed.
 *
 * It follows every mirrored field, not only `at`: `at` has whole seconds, so a write in the same
 * second as the previous one leaves it unchanged. A timer this bar started is remembered by its
 * start second until it first loads as `current` (`markOwnStart`): the current-entry refetch can
 * land before the create call resolves, so the new id may not be known yet. Edits made between
 * Start and that first load belong to the new entry and are saved to it.
 */
export function useRunningDraft(current: TimeEntry | null, fields: RefObject<EntryFieldsHandle | null>) {
  const update = useUpdateRunningEntry();
  const toast = useToast();
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const shownEntryId = useRef<number | null>(null);
  const ownStart = useRef<OwnStart | null>(null);

  const follow = useEffectEvent(() => {
    const step = followRunningEntry({
      current,
      shownEntryId: shownEntryId.current,
      ownStart: ownStart.current,
      draft,
      typing: fields.current?.hasFocus() ?? false,
    });
    switch (step.kind) {
      case 'idle':
        return;
      case 'clear':
        shownEntryId.current = null;
        ownStart.current = null;
        setDraft(EMPTY_DRAFT);
        return;
      case 'adopt':
        shownEntryId.current = step.entryId;
        ownStart.current = null;
        setDraft(step.draft);
        if (Object.keys(step.edits).length > 0)
          update.mutate({ id: step.entryId, ...step.edits }, { onError: toast.error });
        return;
      case 'mirror':
        shownEntryId.current = step.entryId;
        if (step.forgetOwnStart) ownStart.current = null;
        // A refetch of the same entry must not wipe a description that is still being typed.
        setDraft(previous =>
          step.keepDescription ? { ...step.draft, description: previous.description } : step.draft,
        );
        return;
    }
  });
  const signature = current ? `${current.id}\u0002${current.at}\u0002${draftSignature(current)}` : null;
  useEffect(() => follow(), [signature]);

  /** Saves an edit to the running entry. While a start is loading the sync above saves it instead. */
  const patchRunning = (changes: RunningEntryChanges) => {
    if (!current || ownStart.current) return;
    update.mutate({ id: current.id, ...changes }, { onError: toast.error });
  };

  /** Remembers a timer this bar is starting at `startAt`, with the draft it started from. */
  const markOwnStart = (startAt: Date, base: EntryDraft) => {
    ownStart.current = { startMs: Math.floor(startAt.getTime() / 1000) * 1000, base };
  };
  const forgetOwnStart = () => {
    ownStart.current = null;
  };

  return { draft, setDraft, patchRunning, markOwnStart, forgetOwnStart };
}
