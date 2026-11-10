import type { ImportResult } from '@tokkl/types';

/** Named after the day it ran, in UTC. */
export function exportFilename(kind: 'json' | 'csv', now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return kind === 'json' ? `tokkl-${stamp}.json` : `tokkl-entries-${stamp}.csv`;
}

/** Rows of Toggl users not chosen, and rows with problems. */
export function importCounts(result: ImportResult): { otherUsers: number; failed: number } {
  const otherUsers = result.skipped.reduce((sum, item) => sum + item.rows, 0);
  const failed = Math.max(0, result.rows - result.created - result.skipped_duplicates - otherUsers);
  return { otherUsers, failed };
}

/** In the file's order. */
export function toggledUsers(
  users: ImportResult['users'],
  selected: readonly string[],
  key: string,
  checked: boolean,
): string[] {
  return users.map(user => user.key).filter(candidate => (candidate === key ? checked : selected.includes(candidate)));
}

/** The server echoes any JSON value; non-strings show as JSON, since `String` throws on `{"toString": 1}`. */
export function restoreErrorId(id: unknown): string {
  return typeof id === 'string' ? id : (JSON.stringify(id) ?? '');
}
