import type { BulkPatchResult } from '../api/types.ts';

/** Toast texts for edits and deletes of several entries at once. */

export interface ToastText {
  text: string;
  kind: 'info' | 'error';
}

const entryCount = (count: number) => (count === 1 ? '1 entry' : `${count} entries`);

/**
 * What a bulk edit reply says. With `success` (a bulk-bar edit) a reply that lists failures says
 * how many failed; without it (a row edit) the toast shows the first failure alone, and a success
 * says nothing.
 */
export function bulkEditMessage(result: BulkPatchResult, success: string | undefined): ToastText | null {
  const first = result.failure[0];
  if (!first) return success ? { text: success, kind: 'info' } : null;
  return { text: success ? `${result.failure.length} entries failed: ${first.message}` : first.message, kind: 'error' };
}

/** What deleting `requested` entries one by one says when `deleted` of them went and `reason` stopped the rest. */
export function deleteMessage(requested: number, deleted: number, reason: string | null): ToastText {
  if (reason === null) return { text: requested > 1 ? `${requested} entries deleted` : 'Entry deleted', kind: 'info' };
  const failed = requested - deleted;
  const text = deleted
    ? `${entryCount(deleted)} deleted, ${entryCount(failed)} failed: ${reason}`
    : failed > 1
      ? `${failed} entries failed: ${reason}`
      : reason;
  return { text, kind: 'error' };
}
