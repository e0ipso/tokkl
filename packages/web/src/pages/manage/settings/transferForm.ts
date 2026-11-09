import type { ImportResult } from '@tokkl/types';

/** The rules behind the Data card: export file names, import counts and the Toggl user choice. */

/** The file an export saves to, named after the day it ran (UTC, as `toISOString` gives it). */
export function exportFilename(kind: 'json' | 'csv', now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return kind === 'json' ? `tokkl-${stamp}.json` : `tokkl-entries-${stamp}.csv`;
}

/** Rows an import left out: those of Toggl users not chosen, and those with problems. */
export function importCounts(result: ImportResult): { otherUsers: number; failed: number } {
  const otherUsers = result.skipped.reduce((sum, item) => sum + item.rows, 0);
  const failed = Math.max(0, result.rows - result.created - result.skipped_duplicates - otherUsers);
  return { otherUsers, failed };
}

/** The chosen Toggl users after one checkbox changes, in the file's order. */
export function toggledUsers(
  users: ImportResult['users'],
  selected: readonly string[],
  key: string,
  checked: boolean,
): string[] {
  return users.map(user => user.key).filter(candidate => (candidate === key ? checked : selected.includes(candidate)));
}

/**
 * The id a JSON restore problem names, as text. The server echoes whatever the file held there,
 * any JSON value, so a string stays as it is and anything else is shown as JSON: `String` throws on
 * an object such as `{"toString": 1}`.
 */
export function restoreErrorId(id: unknown): string {
  return typeof id === 'string' ? id : (JSON.stringify(id) ?? '');
}
