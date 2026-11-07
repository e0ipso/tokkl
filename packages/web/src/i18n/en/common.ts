import type { MessageGroup } from '../catalog.ts';

/** Words many features share: dialog buttons, loading and error states, toasts. */
export const common = {
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  done: 'Done',
  tryAgain: 'Try again',
  loading: 'Loading…',
  dismiss: 'Dismiss',
  /** Read before an error toast's message, which the icon alone shows on screen. */
  errorPrefix: 'Error: ',
  /** An amount whose currency `Intl` does not know, such as "12.50 XYZ". */
  moneyFallback: '{amount} {currency}',
} as const satisfies MessageGroup;
