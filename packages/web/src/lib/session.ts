import type { QueryClient } from '@tanstack/react-query';
import { authRequests } from '../api/auth.ts';
import { clearCachedTheme } from './theme.ts';

/** In sessionStorage because the tab reloads between the failed logout and the message. */
const LOGOUT_FAILED_KEY = 'tokkl.logoutFailed';

function forgetLogoutFailure(): void {
  try {
    window.sessionStorage.removeItem(LOGOUT_FAILED_KEY);
  } catch {
    // Storage can be blocked; then there is no flag to forget.
  }
}

/** Mounted queries are not notified: callers load a new page or re-render the readers. */
export function endSession(qc: QueryClient): void {
  qc.clear();
  clearCachedTheme();
  forgetLogoutFailure();
}

const signOutListeners = new Set<() => void>();

/** Fires before the logout request; the timer stream closes here so no 403 read follows the server ending it. */
export function onSignOut(listener: () => void): () => void {
  signOutListeners.add(listener);
  return () => signOutListeners.delete(listener);
}

/**
 * Closes streams and cancels reads first, so nothing reaches the server with the cookie it is revoking.
 * A failure leaves a flag for `takeLogoutFailure` and rejects after cleanup.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  for (const listener of [...signOutListeners]) listener();
  await qc.cancelQueries();
  try {
    await authRequests.logout();
  } catch (error) {
    endSession(qc);
    try {
      window.sessionStorage.setItem(LOGOUT_FAILED_KEY, '1');
    } catch {
      // Storage can be blocked. The reload then shows the account without saying why.
    }
    throw error;
  }
  endSession(qc);
}

/** Clears the flag. Read it only once the server confirmed the session: a 403 drops the flag. */
export function takeLogoutFailure(): boolean {
  try {
    const failed = window.sessionStorage.getItem(LOGOUT_FAILED_KEY) !== null;
    window.sessionStorage.removeItem(LOGOUT_FAILED_KEY);
    return failed;
  } catch {
    return false;
  }
}
