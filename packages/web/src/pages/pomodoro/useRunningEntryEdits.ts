import { useEffect, useEffectEvent, useRef } from 'react';
import { useUpdateRunningEntry } from '../../api/entries.ts';
import type { RunningEntryChanges } from '../../api/timerHooks.ts';
import { useToast } from '../../components/Toast.tsx';
import type { EntryDraft } from '../../components/useEntryFields.ts';

const DESCRIPTION_SAVE_DELAY_MS = 800;

/** Typing waits a moment and saves on blur; other fields save at once. Next phase and End call `settle` first. */
export function useRunningEntryEdits(entryId: number | null) {
  const update = useUpdateRunningEntry();
  const toast = useToast();
  const waiting = useRef<{ id: number; description: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const send = (id: number, changes: RunningEntryChanges) =>
    update.mutateAsync({ id, ...changes }).then(() => {}, toast.error);
  const settle = (): Promise<void> => {
    const pending = waiting.current;
    if (!pending) return Promise.resolve();
    clearTimeout(pending.timer);
    waiting.current = null;
    return send(pending.id, { description: pending.description });
  };
  // Leaving the page or the session ending elsewhere still saves what was typed.
  const settleLater = useEffectEvent(() => void settle());
  useEffect(() => () => settleLater(), []);
  return {
    pending: () => waiting.current !== null,
    settle,
    type(description: string) {
      if (entryId === null) return;
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current = {
        id: entryId,
        description,
        timer: setTimeout(() => void settle(), DESCRIPTION_SAVE_DELAY_MS),
      };
    },
    edit(changes: Partial<EntryDraft>) {
      if (entryId === null) return;
      if ('description' in changes && waiting.current) {
        clearTimeout(waiting.current.timer);
        waiting.current = null;
      }
      void send(entryId, changes);
    },
  };
}
