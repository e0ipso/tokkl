import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { notificationAccess, notifyInBackground, notifySessionPhaseEnd, requestNotificationAccess } from './phaseNotification.ts';

// A minimal window, document and Notification stand in for the browser's. `setup` picks what the
// page reports: its permission, a permission request's answer, whether the API exists or its
// constructor throws (as Chrome on Android does), a secure context and the page's visibility.
interface Setup {
  permission?: NotificationPermission | 'throws';
  answer?: NotificationPermission | 'rejects';
  support?: 'works' | 'missing' | 'throws';
  secure?: boolean;
  hidden?: boolean;
  focused?: boolean;
}

const page = { secure: true, hidden: true, focused: false, focusCalls: 0, requests: 0 };
Object.assign(globalThis, {
  window: {
    get isSecureContext() { return page.secure; },
    focus: () => void page.focusCalls++,
  },
  document: {
    hasFocus: () => page.focused,
    get visibilityState() { return page.hidden ? 'hidden' : 'visible'; },
  },
});

class Shown {
  title: string;
  options: NotificationOptions;
  closed = false;
  onclick: (() => void) | null = null;
  constructor(title: string, options: NotificationOptions) {
    this.title = title;
    this.options = options;
  }
  close() {
    this.closed = true;
  }
}

let shown: Shown[] = [];

function setup({ permission = 'granted', answer = 'granted', support = 'works', secure = true, hidden = true, focused = false }: Setup = {}) {
  Object.assign(page, { secure, hidden, focused, focusCalls: 0, requests: 0 });
  shown = [];
  if (support === 'missing') {
    Reflect.deleteProperty(globalThis, 'Notification');
    return;
  }
  let current = permission;
  function StubNotification(title: string, options: NotificationOptions = {}) {
    if (support === 'throws') throw new TypeError("Failed to construct 'Notification': Illegal constructor.");
    const notification = new Shown(title, options);
    shown.push(notification);
    return notification;
  }
  Object.defineProperty(StubNotification, 'permission', {
    get() {
      if (current === 'throws') throw new DOMException('The operation is insecure.', 'SecurityError');
      return current;
    },
  });
  Object.assign(StubNotification, {
    async requestPermission() {
      page.requests++;
      if (answer === 'rejects') throw new DOMException('The request was refused.', 'NotAllowedError');
      current = answer;
      return answer;
    },
  });
  Object.assign(globalThis, { Notification: StubNotification });
}

test('a background notification shows its title, body and tag with the app icon', () => {
  setup();
  notifyInBackground('Is your timer still running on purpose?', 'Open Tokkl to confirm or review it.', 'tokkl-long-timer-7');
  notifyInBackground('Still tracking', 'Check your timer', 'tokkl-long-timer-8');
  assert.deepEqual(shown.map(({ title, options }) => [title, options.body, options.tag]), [
    ['Is your timer still running on purpose?', 'Open Tokkl to confirm or review it.', 'tokkl-long-timer-7'],
    ['Still tracking', 'Check your timer', 'tokkl-long-timer-8'],
  ]);
  for (const { options } of shown) assert.equal(options.icon, '/icons/icon-192.png');
  assert.ok(existsSync(new URL('../../public/icons/icon-192.png', import.meta.url)), 'the icon is a file the app serves');
});

test('a page in view shows no notification, even with permission', () => {
  setup({ hidden: false });
  notifyInBackground('Still tracking', 'Check your timer', 'long-timer');
  assert.deepEqual(shown, []);
});

test('without permission, a secure context or the API, a hidden page shows nothing and never asks', () => {
  const blocked: Setup[] = [
    { permission: 'default' },
    { permission: 'denied' },
    { permission: 'throws' },
    { secure: false },
    { support: 'missing' },
  ];
  for (const browser of blocked) {
    setup(browser);
    assert.doesNotThrow(() => notifyInBackground('Still tracking', 'Check your timer', 'long-timer'), JSON.stringify(browser));
    assert.deepEqual(shown, [], JSON.stringify(browser));
    assert.equal(page.requests, 0, `a background notification never requests permission: ${JSON.stringify(browser)}`);
  }
});

test('a constructor that throws leaves the page without a notification or an error', () => {
  setup({ support: 'throws' });
  assert.doesNotThrow(() => notifyInBackground('Still tracking', 'Check your timer', 'long-timer'));
  assert.deepEqual(shown, []);
});

test('a click on the notification focuses the tab and closes the notification', () => {
  setup();
  notifyInBackground('Still tracking', 'Check your timer', 'long-timer');
  const [notification] = shown;
  assert.ok(notification?.onclick, 'the notification has a click handler');
  assert.equal(notification.closed, false);
  assert.equal(page.focusCalls, 0);
  notification.onclick();
  assert.equal(page.focusCalls, 1);
  assert.equal(notification.closed, true);
});

test('access reports the permission, or why the page cannot have one', () => {
  const cases: [Setup, string][] = [
    [{ permission: 'default' }, 'default'],
    [{ permission: 'granted' }, 'granted'],
    [{ permission: 'denied' }, 'denied'],
    [{ secure: false }, 'insecure'],
    [{ secure: false, support: 'missing' }, 'insecure'],
    [{ support: 'missing' }, 'unsupported'],
    [{ permission: 'throws' }, 'unsupported'],
  ];
  for (const [browser, access] of cases) {
    setup(browser);
    assert.equal(notificationAccess(), access, JSON.stringify(browser));
  }
});

test('a request asks the browser only while the permission is undecided', async () => {
  const cases: [Setup, string, number][] = [
    [{ permission: 'default', answer: 'granted' }, 'granted', 1],
    [{ permission: 'default', answer: 'denied' }, 'denied', 1],
    [{ permission: 'default', answer: 'default' }, 'default', 1],
    [{ permission: 'default', answer: 'rejects' }, 'default', 1],
    [{ permission: 'granted' }, 'granted', 0],
    [{ permission: 'denied' }, 'denied', 0],
    [{ permission: 'default', secure: false }, 'insecure', 0],
    [{ support: 'missing' }, 'unsupported', 0],
  ];
  for (const [browser, access, requests] of cases) {
    setup(browser);
    assert.equal(await requestNotificationAccess(), access, JSON.stringify(browser));
    assert.equal(page.requests, requests, `requests for ${JSON.stringify(browser)}`);
  }
});

for (const hidden of [false, true]) {
  test(`an unfocused ${hidden ? 'hidden' : 'visible'} session requests persistent renotification tagged with the phase start`, () => {
    setup({ hidden });
    for (const phase of ['Work', 'Short rest', 'Long rest']) {
      const notification = notifySessionPhaseEnd('2026-10-27T10:00:00.000Z', phase);
      assert.equal(notification, shown.at(-1));
    }
    assert.deepEqual(shown.map(({ title }) => title), ['Work phase over', 'Short rest phase over', 'Long rest phase over']);
    for (const notification of shown) {
      assert.deepEqual(notification.options, {
        body: 'Choose Next phase or End session in Tokkl.', icon: '/icons/icon-192.png',
        tag: 'tokkl-pomodoro-session-2026-10-27T10:00:00.000Z', requireInteraction: true, renotify: true,
      });
    }
    notifySessionPhaseEnd('2026-10-27T10:31:00.000Z', 'Short rest');
    assert.equal(shown.at(-1)?.options.tag, 'tokkl-pomodoro-session-2026-10-27T10:31:00.000Z');
    assert.equal(page.requests, 0);
  });
}

test('session notifications stay quiet while focused and focus and close on click', () => {
  setup({ hidden: false, focused: true });
  assert.equal(notifySessionPhaseEnd('a', 'Work'), null);
  assert.equal(shown.length, 0);
  page.focused = false;
  notifySessionPhaseEnd('a', 'Work');
  const notification = shown[0]!;
  assert.ok(notification.onclick);
  assert.equal(notification.closed, false);
  notification.onclick();
  assert.equal(page.focusCalls, 1);
  assert.equal(notification.closed, true);
});

for (const browser of [
  { permission: 'default' }, { permission: 'denied' }, { permission: 'throws' },
  { secure: false }, { support: 'missing' }, { support: 'throws' },
] satisfies Setup[]) {
  test(`session notifications guard ${JSON.stringify(browser)} without requesting permission`, () => {
    setup({ ...browser, hidden: false });
    assert.equal(notifySessionPhaseEnd('a', 'Work'), null);
    assert.deepEqual(shown, []);
    assert.equal(page.requests, 0);
  });
}

test('long-timer reminders still require a hidden page even when a visible window lacks focus', () => {
  setup({ hidden: false, focused: false });
  notifyInBackground('Still tracking', 'Check your timer', 'long-timer');
  assert.equal(shown.length, 0);
  page.hidden = true;
  notifyInBackground('Still tracking', 'Check your timer', 'long-timer');
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0]?.options, { body: 'Check your timer', icon: '/icons/icon-192.png', tag: 'long-timer' });
});
