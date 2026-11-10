import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { useUpdateRunningEntry } from '../api/entries.ts';
import type { RunningEntryChanges } from '../api/timerHooks.ts';
import type { TimeEntry } from '@tokkl/types';
import type { EntryFieldsHandle } from './EntryFields.tsx';
import { useToast } from './Toast.tsx';
import { followRunningEntry, type OwnStart } from './runningDraftSync.ts';
import { EMPTY_DRAFT, draftSignature, type EntryDraft } from './useEntryFields.ts';

/**
 * Only this hook resets the draft after a start or stop, so an early refetch cannot wipe typing. Its own start
 * is remembered by start second until it loads (`markOwnStart`); edits meanwhile are saved to it.
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

  /** While a start is loading the sync above saves it instead. */
  const patchRunning = (changes: RunningEntryChanges) => {
    if (!current || ownStart.current) return;
    update.mutate({ id: current.id, ...changes }, { onError: toast.error });
  };

  const markOwnStart = (startAt: Date, base: EntryDraft) => {
    ownStart.current = { startMs: Math.floor(startAt.getTime() / 1000) * 1000, base };
  };
  const forgetOwnStart = () => {
    ownStart.current = null;
  };

  return { draft, setDraft, patchRunning, markOwnStart, forgetOwnStart };
}
