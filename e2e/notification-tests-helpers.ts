import type { Page } from '@playwright/test';

// Installed before the app loads: the real prompt and notifications are outside the page, and the headless
// shell reports the permission as denied.

export interface NotificationSetup {
  permission?: NotificationPermission;
  /** 'rejects' makes the request fail. */
  answer?: NotificationPermission | 'rejects';
  /** 'missing' removes window.Notification; 'throws' makes its constructor throw. */
  support?: 'works' | 'missing' | 'throws';
  /** false makes the page a non-secure context, as plain HTTP from another host is. */
  secure?: boolean;
}

export interface ShownNotification {
  title: string;
  body: string | null;
  closed: boolean;
}

interface StubbedNotification {
  title: string;
  options: NotificationOptions;
  closed: boolean;
  onclick: ((event: Event) => void) | null;
}

declare global {
  interface Window {
    notificationStub: {
      shown: StubbedNotification[];
      requests: number;
      focusCalls: number;
      hidden: boolean;
    };
  }
}

export async function stubNotifications(
  page: Page,
  { permission = 'default', answer = 'granted', support = 'works', secure = true }: NotificationSetup = {},
) {
  await page.addInitScript(
    ({ permission, answer, support, secure }) => {
      const stub: Window['notificationStub'] = { shown: [], requests: 0, focusCalls: 0, hidden: false };
      window.notificationStub = stub;
      Object.defineProperty(Document.prototype, 'visibilityState', {
        configurable: true,
        get: () => (stub.hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => stub.hidden });
      window.focus = () => {
        stub.focusCalls++;
      };
      if (!secure) Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
      if (support === 'missing') {
        delete (window as { Notification?: unknown }).Notification;
        return;
      }
      let current = permission;
      function StubNotification(this: StubbedNotification, title: string, options: NotificationOptions = {}) {
        // Chrome on Android throws this for page notifications.
        if (support === 'throws') throw new TypeError("Failed to construct 'Notification': Illegal constructor.");
        this.title = title;
        this.options = options;
        this.closed = false;
        this.onclick = null;
        stub.shown.push(this);
      }
      StubNotification.prototype.close = function close(this: StubbedNotification) {
        this.closed = true;
      };
      Object.defineProperty(StubNotification, 'permission', { get: () => current });
      Object.defineProperty(StubNotification, 'requestPermission', {
        value: () => {
          stub.requests++;
          if (answer === 'rejects')
            return Promise.reject(new DOMException('The request was refused', 'NotAllowedError'));
          current = answer;
          return Promise.resolve(answer);
        },
      });
      Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: StubNotification });
    },
    { permission, answer, support, secure },
  );
}

export async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    window.notificationStub.hidden = value;
    // The app's focus listener is on window, so the event has to bubble.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, hidden);
}

export function shownNotifications(page: Page): Promise<ShownNotification[]> {
  return page.evaluate(() =>
    window.notificationStub.shown.map(notification => ({
      title: notification.title,
      body: notification.options.body ?? null,
      closed: notification.closed,
    })),
  );
}

export async function clickNotification(page: Page, index: number) {
  await page.evaluate(at => {
    const notification = window.notificationStub.shown[at];
    if (!notification) throw new Error(`No notification at ${at}`);
    notification.onclick?.call(notification, new Event('click'));
  }, index);
}

export function permissionRequests(page: Page): Promise<number> {
  return page.evaluate(() => window.notificationStub.requests);
}

export function focusCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.notificationStub.focusCalls);
}
