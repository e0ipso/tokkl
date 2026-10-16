import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { clearCachedTheme } from './theme.ts';

/**
 * Forgets what the signed-in user left in this tab: every cached query and the cached theme. The
 * page returns to the system theme, so the login page and the next user start clean.
 *
 * Clearing the cache does not notify mounted queries; they keep their last result until their
 * component renders again. Callers either load a new page or re-render the components that read
 * the cleared queries.
 */
export function endSession(qc: QueryClient): void {
  qc.clear();
  clearCachedTheme();
}

/**
 * Asks the server to end the session, then ends it in this tab whether the request succeeded or
 * not. A failed request still rejects, after the cleanup.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  try {
    await api.post('/api/app/logout');
  } finally {
    endSession(qc);
  }
}
