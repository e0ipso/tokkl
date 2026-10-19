import type { PhaseEnd } from './pomodoroCycle.ts';

/** What a phase end says. The banner shows both parts; a notification uses them as title and body. */
export const PHASE_ENDED: Record<PhaseEnd, { title: string; body: string }> = {
  work: { title: 'Work phase over', body: 'Time for a break.' },
  short: { title: 'Short break over', body: 'Back to work.' },
  long: { title: 'Long break over', body: 'Back to work.' },
};

/**
 * The browser's notification permission. 'insecure' is a page served over plain HTTP from another
 * host, where browsers refuse notifications; 'unsupported' is a browser without the API.
 */
export type NotificationAccess = NotificationPermission | 'insecure' | 'unsupported';

const ICON_URL = '/icons/icon-192.png';
/** One tag for every phase end, so a newer notification replaces an older one, from any tab. */
const TAG = 'tokkl-pomodoro';

function notificationApi(): typeof Notification | null {
  return typeof Notification === 'function' ? Notification : null;
}

export function notificationAccess(): NotificationAccess {
  if (!window.isSecureContext) return 'insecure';
  const api = notificationApi();
  if (!api) return 'unsupported';
  try {
    return api.permission;
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser for permission and returns what it answered. Call it only from the Allow
 * notifications button's click handler. Browsers ignore or block a request without a user gesture.
 */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  const api = notificationApi();
  if (!api || notificationAccess() !== 'default') return notificationAccess();
  try {
    await api.requestPermission();
  } catch {
    // A refused or failed request leaves the permission as it was.
  }
  return notificationAccess();
}

/**
 * Shows a notification for the phase that ended, but only while the page is hidden; in view, the
 * banner and the bell say it. Without the API or permission, or when the constructor throws, as
 * Chrome on Android does for page notifications, nothing shows. A click focuses the tab and closes
 * the notification.
 */
export function notifyPhaseEnd(phase: PhaseEnd): void {
  if (document.visibilityState !== 'hidden') return;
  const api = notificationApi();
  if (!api || notificationAccess() !== 'granted') return;
  try {
    const { title, body } = PHASE_ENDED[phase];
    const notification = new api(title, { body, icon: ICON_URL, tag: TAG });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // No notifications here; the banner still shows when the tab comes back.
  }
}
