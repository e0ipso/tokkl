import type { MessageGroup } from '../catalog.ts';

export const common = {
  close: 'Close',
  cancel: 'Cancel',
  cancelDownload: 'Cancel download',
  save: 'Save',
  delete: 'Delete',
  done: 'Done',
  tryAgain: 'Try again',
  undo: 'Undo',
  loading: 'Loading…',
  dismiss: 'Dismiss',
  /** Read before an error toast's message, which the icon alone shows on screen. */
  errorPrefix: 'Error: ',
  /** For a currency `Intl` does not know. */
  moneyFallback: '{amount} {currency}',
} as const satisfies MessageGroup;
