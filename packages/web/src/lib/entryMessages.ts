import type { BulkPatchResult } from '@tokkl/types';
import { t } from '../i18n/messages.ts';

interface ToastText {
  text: string;
  kind: 'info' | 'error';
}

const entryCount = (count: number) => t('entries.count', { count });

/** With `success` (bulk bar) failures are counted; without it (a row edit) the first failure shows alone. */
export function bulkEditMessage(result: BulkPatchResult, success: string | undefined): ToastText | null {
  const first = result.failure[0];
  if (!first) return success ? { text: success, kind: 'info' } : null;
  return {
    text: success ? t('entries.failedMany', { count: result.failure.length, reason: first.message }) : first.message,
    kind: 'error',
  };
}

export function deleteMessage(requested: number, deleted: number, reason: string | null): ToastText {
  if (reason === null)
    return {
      text: requested > 1 ? t('entries.deletedMany', { count: requested }) : t('entries.deleted'),
      kind: 'info',
    };
  const failed = requested - deleted;
  const text = deleted
    ? t('entries.partlyDeleted', { deleted: entryCount(deleted), failed: entryCount(failed), reason })
    : failed > 1
      ? t('entries.failedMany', { count: failed, reason })
      : reason;
  return { text, kind: 'error' };
}
