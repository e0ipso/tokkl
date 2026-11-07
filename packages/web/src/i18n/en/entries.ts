import type { MessageGroup } from '../catalog.ts';

/** Time entries: the list, its rows and menus, the editor, the shared fields and pickers. */
export const entries = {
  /** The toast after saving a finished entry, with the duration the server stored. */
  added: 'Added {duration}',
} as const satisfies MessageGroup;
