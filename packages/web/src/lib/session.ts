import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { clearCachedTheme } from './theme.ts';

/**
 * Set when a logout request fails, so the page that loads next can say the user is still signed
 * in. It lives in sessionStorage because the tab reloads between the failure and the message.
 */
const LOGOUT_FAILED_KEY = 'tokkl.logoutFailed';

function forgetLogoutFailure(): void {
  try {
    window.sessionStorage.removeItem(LOGOUT_FAILED_KEY);
  } catch {
    // Storage can be blocked; then there is no flag to forget.
  }
}

/**
 * Forgets what the signed-in user left in this tab: every cached query, the cached theme and a
 * pending logout failure message. The page returns to the system theme, so the login page and the
 * next user start clean.
 *
 * Clearing the cache does not notify mounted queries; they keep their last result until their
 * component renders again. Callers either load a new page or re-render the components that read
 * the cleared queries.
 */
export function endSession(qc: QueryClient): void {
  qc.clear();
  clearCachedTheme();
  forgetLogoutFailure();
}

/**
 * Revokes the cookie, then ends the session in this tab whether logout succeeded or not. A
 * Pomodoro session lives on the server and keeps running. A failed logout leaves a flag for
 * `takeLogoutFailure` and rejects after cleanup.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  try {
    await api.post('/api/app/logout');
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

/**
 * Whether the last logout in this tab failed, clearing the flag so the message shows once. Read it
 * only once the server has confirmed the session: a 403 ends the session, which drops the flag.
 */
export function takeLogoutFailure(): boolean {
  try {
    const failed = window.sessionStorage.getItem(LOGOUT_FAILED_KEY) !== null;
    window.sessionStorage.removeItem(LOGOUT_FAILED_KEY);
    return failed;
  } catch {
    return false;
  }
}
