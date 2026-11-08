import { useEffect, useEffectEvent, useRef } from 'react';
import { useUpdateRunningEntry } from '../../api/entries.ts';
import type { TimeEntryInput } from '../../api/types.ts';
import { useToast } from '../../components/Toast.tsx';
import type { EntryDraft } from '../../components/useEntryFields.ts';

/** How long typing in the description waits before saving it to the running entry. */
const DESCRIPTION_SAVE_DELAY_MS = 800;

/**
 * Saves edits of the open pomodoro to its running entry with v9 updates. Typing waits a moment and
 * saves on blur; other fields save at once. `settle` sends a waiting description now. Next phase and
 * End session call it first, and the actions wait for the edit, so the next pomodoro copies it.
 */
export function useRunningEntryEdits(entryId: number | null) {
  const update = useUpdateRunningEntry();
  const toast = useToast();
  const waiting = useRef<{ id: number; description: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const send = (id: number, changes: TimeEntryInput) =>
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
