import { api, download, rawBody } from './client.ts';
import { object } from './decode.ts';
import { APP } from './paths.ts';
import type { ImportResult, JsonRestoreResult } from '@tokkl/types';

/** Exports, the Toggl CSV import and the Tokkl JSON restore. Pass `stale.imported` after a real import. */

/** The query string for a CSV import request: preview or not, and the chosen Toggl users. */
export function importQuery(dryRun: boolean, users: readonly string[]): string {
  const params = new URLSearchParams();
  if (dryRun) params.set('dry_run', 'true');
  for (const key of users) params.append('user', key);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const transferRequests = {
  /**
   * Saves the account's data as a file: JSON with everything, or CSV with one row per entry.
   * `signal` cancels the download.
   */
  export: (kind: 'json' | 'csv', filename: string, signal?: AbortSignal) =>
    download(`${APP}/export.${kind}`, filename, { signal }),
  importTogglCsv: (text: string, dryRun: boolean, users: readonly string[]) =>
    api.post<ImportResult>(`${APP}/import/toggl-csv${importQuery(dryRun, users)}`, rawBody(text, 'text/csv'), {
      decode: object,
    }),
  restoreJson: (text: string, dryRun: boolean) =>
    api.post<JsonRestoreResult>(
      `${APP}/import/json${dryRun ? '?dry_run=true' : ''}`,
      rawBody(text, 'application/json'),
      {
        decode: object,
      },
    ),
};
