import { useBulkPatch, useDeleteEntry, useRestoreEntry } from '../api/entries.ts';
import type { PatchOperation } from '@tokkl/types';
import { bulkEditMessage, deleteMessage } from '../lib/entryMessages.ts';
import { useToast } from './Toast.tsx';
import { t } from '../i18n/messages.ts';

/**
 * Deletes each entry on its own, so one failure (say, an entry another device already deleted)
 * does not stop the rest. The toast counts what was deleted and what failed, and Undo restores
 * only the entries this call deleted.
 */
export function useDeleteEntries(): (ids: number[]) => Promise<void> {
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const toast = useToast();
  return async ids => {
    const results = await Promise.allSettled(ids.map(id => remove.mutateAsync(id)));
    const deleted = ids.filter((_, index) => results[index]?.status === 'fulfilled');
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    const undo = deleted.length
      ? { label: t('common.undo'), run: () => deleted.forEach(id => restore.mutate(id)) }
      : undefined;
    const reason = !failure ? null : failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    const message = deleteMessage(ids.length, deleted.length, reason);
    toast.show(message.text, { kind: message.kind, action: undo });
  };
}

export interface BulkEditOptions {
  /** The toast after a bulk-bar edit; see `bulkEditMessage`. */
  success?: string;
  /** Runs once the server answered, whatever it answered. */
  onDone?: () => void;
}

/**
 * Applies JSON Patch operations to several entries in one request and reports the reply in a toast.
 * The promise settles with the request, for a caller that keeps other actions out until then; it
 * never rejects, because the toast already reports a failure.
 */
export function useBulkEdit(): (
  ids: number[],
  operations: PatchOperation[],
  options?: BulkEditOptions,
) => Promise<void> {
  const bulk = useBulkPatch();
  const toast = useToast();
  return (ids, operations, { success, onDone } = {}) =>
    new Promise(resolve => {
      bulk.mutate(
        { ids, operations },
        {
          onSuccess: result => {
            const message = bulkEditMessage(result, success);
            if (message) toast.show(message.text, { kind: message.kind });
            onDone?.();
          },
          onError: toast.error,
          onSettled: () => resolve(),
        },
      );
    });
}
