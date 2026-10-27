/**
 * The browser's notification permission. 'insecure' is a page served over plain HTTP from another
 * host, where browsers refuse notifications; 'unsupported' is a browser without the API.
 */
export type NotificationAccess = NotificationPermission | 'insecure' | 'unsupported';

const ICON_URL = '/icons/icon-192.png';

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
 * Shows a notification, but only while the page is hidden; in view, the in-app banner says it.
 * Without the API or permission, or when the constructor throws, as Chrome on Android does for page
 * notifications, nothing shows, and the banner remains. A notification with the same tag replaces
 * the previous one. A click focuses the tab and closes the notification.
 */
export function notifyInBackground(title: string, body: string, tag: string): void {
  if (document.visibilityState !== 'hidden') return;
  const api = notificationApi();
  if (!api || notificationAccess() !== 'granted') return;
  try {
    const notification = new api(title, { body, icon: ICON_URL, tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // No notifications here; the banner still shows when the tab comes back.
  }
}

/**
 * hasFocus also detects a visible window that is not in front, unlike visibilityState.
 * https://developer.mozilla.org/en-US/docs/Web/API/Document/hasFocus
 * requireInteraction and renotify have limited support: a browser may ignore persistence or
 * replacement alerts. Keep the in-app banner and loop until Next/End regardless of dismissal.
 * https://developer.mozilla.org/en-US/docs/Web/API/Notification/requireInteraction
 * https://developer.mozilla.org/en-US/docs/Web/API/Notification/renotify
 */
export function notifySessionPhaseEnd(phaseStart: string, phaseLabel: string): Notification | null {
  if (document.hasFocus()) return null;
  const api = notificationApi();
  if (!api || notificationAccess() !== 'granted') return null;
  try {
    // renotify needs a non-empty tag. It is the phase start, the alarm's key, so the tabs of this
    // browser that ring for the same phase share one notification.
    const options = {
      body: 'Choose Next phase or End session in Tokkl.', icon: ICON_URL,
      tag: `tokkl-pomodoro-session-${phaseStart}`, requireInteraction: true, renotify: true,
    };
    const notification = new api(`${phaseLabel} phase over`, options);
    notification.onclick = () => { window.focus(); notification.close(); };
    return notification;
  } catch {
    // Some browsers reject page Notification construction even with permission.
    return null;
  }
}
