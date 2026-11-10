import { t } from '../i18n/messages.ts';

/** 'insecure': plain HTTP from another host, where browsers refuse notifications; 'unsupported': no API. */
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

/** Call only from the Allow notifications click: browsers ignore or block a request without a user gesture. */
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

/** Only while the page is hidden. Chrome on Android throws for page notifications; the banner remains then. */
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
 * hasFocus also catches a visible window not in front. requireInteraction and renotify are unreliable,
 * so the banner stays and the alarm loops until Next/End.
 */
export function notifySessionPhaseEnd(phaseStart: string, phaseLabel: string): Notification | null {
  if (document.hasFocus()) return null;
  const api = notificationApi();
  if (!api || notificationAccess() !== 'granted') return null;
  try {
    // renotify needs a non-empty tag. It is the phase start, the alarm's key, so the tabs of this
    // browser that ring for the same phase share one notification.
    const options = {
      body: t('timer.phaseOverBody'),
      icon: ICON_URL,
      tag: `tokkl-pomodoro-session-${phaseStart}`,
      requireInteraction: true,
      renotify: true,
    };
    const notification = new api(t('timer.phaseOverTitle', { phase: phaseLabel }), options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return notification;
  } catch {
    // Some browsers reject page Notification construction even with permission.
    return null;
  }
}
