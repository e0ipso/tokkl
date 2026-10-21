import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { forgetChains } from '../components/pauseChain.ts';
import { forgetPomodoro } from '../components/pomodoroCycle.ts';
import { finishPomodoroSession, forgetActivePomodoroSession } from '../components/pomodoroSessionLifecycle.ts';
import { forgetPomodoroSessions } from '../components/pomodoroSessionState.ts';
import { forgetTabChain } from '../components/tabChain.ts';
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

function forgetTimerState(): void {
  // The tab's own copy goes first and outside the try, so blocked storage cannot skip it.
  forgetTabChain();
  forgetActivePomodoroSession();
  try {
    forgetChains(window.localStorage);
    forgetPomodoro(window.localStorage);
    forgetPomodoroSessions(window.localStorage);
  } catch {
    // Storage can be blocked; then nothing was stored.
  }
}

/**
 * Forgets what the signed-in user left in this tab: every cached query, the cached theme, paused
 * timer chains, Pomodoro cycles and sessions, and a pending logout failure message. The page returns to the
 * system theme, so the login page and the next user start clean.
 *
 * Clearing the cache does not notify mounted queries; they keep their last result until their
 * component renders again. Callers either load a new page or re-render the components that read
 * the cleared queries.
 */
export function endSession(qc: QueryClient): void {
  qc.clear();
  clearCachedTheme();
  forgetTimerState();
  forgetLogoutFailure();
}

/**
 * Finishes the current pomodoro before revoking the cookie, then ends the session in this tab
 * whether logout succeeded or not. A failed final save is discarded; a failed logout leaves a
 * flag for `takeLogoutFailure` and rejects after cleanup.
 */
export async function logOut(qc: QueryClient): Promise<void> {
  await finishPomodoroSession();
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
