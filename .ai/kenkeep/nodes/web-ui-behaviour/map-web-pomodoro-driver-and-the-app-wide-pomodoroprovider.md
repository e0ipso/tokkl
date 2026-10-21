---
type: map
title: 'Web notifications: phaseNotification.ts and the Allow notifications button'
description: >-
  notificationAccess and AllowNotifications; notifyInBackground for long-timer
  reminders, notifySessionPhaseEnd for Pomodoro sessions.
tags:
  - web
  - notifications
  - pomodoro
  - timer
kk_schema_version: 3
kk_id: map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:map:1'
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:3'
kk_relates_to:
  - map-web-pomodoro-sessions-provider-controller-and-account-state
  - practice-preferences-validated-by-known-key
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/phaseNotification.ts` holds every page-level system notification in the web app. `notificationAccess()` reports the permission, or `insecure` for a page served over plain HTTP from another host and `unsupported` without the API. `requestNotificationAccess()` asks for permission; call it only from a click handler, since browsers ignore or block a request made without a user gesture. `AllowNotifications` in `pages/manage/settings/AllowNotifications.tsx` is the button that calls it, shown in Settings under Preferences and on the `/pomodoro` page.

`notifyInBackground(title, body, tag)` shows a notification only while `document.visibilityState` is `hidden`; in view, the in-app banner carries the message. `LongTimerReminder.tsx`, mounted in the signed-in shell, uses it for the long-timer reminder, tagged `tokkl-long-timer-<user id>`. `notifySessionPhaseEnd` serves Pomodoro sessions and checks `document.hasFocus()` instead (see `map-web-pomodoro-sessions-provider-controller-and-account-state`). Neither shows anything without the API or a granted permission, or when the constructor throws, as Chrome on Android does for page notifications. A notification with the same tag replaces the previous one, and a click focuses the window and closes it.

The headless shell reports the permission as denied, so `e2e/settings-pomodoro.spec.ts`, `e2e/timer-pomodoro-session.spec.ts` and `e2e/timer-reminder.spec.ts` replace the API with `stubNotifications` from `e2e/notification-tests-helpers.ts`, an init script that runs before the app loads. `e2e/timer-reminder.spec.ts` hides the page with the same file's `setHidden`. `phaseNotification.test.ts` unit-tests the pure parts.

<!-- kk:related:start -->
# Related

- Related: [map-web-pomodoro-sessions-provider-controller-and-account-state](map-web-pomodoro-sessions-provider-controller-and-account-state.md)
- Related: [practice-preferences-validated-by-known-key](../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:map:1
[2] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:3
<!-- kk:citations:end -->
