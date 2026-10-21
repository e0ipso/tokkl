---
type: map
title: 'Web Pomodoro sessions: provider, controller and account state'
description: >-
  PomodoroSessionProvider, mounted in the signed-in shell, owns account-local
  sessions: the /pomodoro page, banner, title, unsaved queue.
tags:
  - web
  - pomodoro
  - timer
  - localstorage
kk_schema_version: 3
kk_id: map-web-pomodoro-sessions-provider-controller-and-account-state
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:0'
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:map:0'
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:1'
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - practice-end-sessions-through-lib-session
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock
  - map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
  - map-pomodoro-cycle-functions-in-packages-common
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/PomodoroSessionProvider.tsx` exposes `usePomodoroSession` to the signed-in shell: `packages/web/src/App.tsx` mounts it directly inside `PauseCoordinationProvider`, around `Shell`. It holds the web app's only Pomodoro state. It remounts account state by `me.id` and delegates `start`, `nextPhase`, `end` and `updateFields` to `createPomodoroSessionController` in `pomodoroSessionController.ts`. Each operation captures one instant before entering the lock; the shared model receives explicit instants.

`pomodoroSessionState.ts` owns device-local account state in `localStorage` under `tokkl.pomodoroSession.<accountId>`, serialized as version 1. It keeps the session id, revision, config, phase, exact `pomodoroStart`, ending claim, entry-field snapshot and the `unsaved` queue of ended pomodoros, which is written in the same record as the phase change. `sessionFields` whitelists description, project, task, tags and billable, copying tags. Invalid or future records parse as no session. The provider listens for storage changes.

Moving from rest to work saves the preceding work-plus-rest span; End saves through the captured end instant. `pomodoroEntrySpan` from `packages/common/pomodoroSession.ts` wraps `snapSpan` with the signed-in account's timezone and resolution. The next pomodoro retains the unsnapped boundary. A collapsed span shows `This pomodoro was too short to save.` and sends no entry POST.

`packages/web/src/pages/PomodoroPage.tsx` serves `/pomodoro`. Its work, short rest, long rest and long-rest-every lengths belong to the session: they default from the four `pomodoro_*` length preferences, falling back to `DEFAULT_POMODORO_SESSION_CONFIG` (see `map-pomodoro-cycle-functions-in-packages-common`), and are checked against `POMODORO_SESSION_CONFIG_RANGES` from `@tokkl/common/pomodoroSession`, but starting a session never writes preferences. The page reuses `EntryFields` for the entry and `AllowNotifications` from the Settings page for the permission button, shows the phase, countdown and overtime, and calls the provider for every change. `PomodoroSessionBanner`, mounted in `App.tsx` on every signed-in route, carries the phase and its actions off the page, and `sessionTitle` in `pomodoroSessionPresentation.ts` puts the phase and countdown, or the overtime, in the document title.

Session phases notify through `notifySessionPhaseEnd` in `phaseNotification.ts`. It shows when `document.hasFocus()` is false, which also catches a visible window that is not in front, and tags the notification `tokkl-pomodoro-session-<sessionId>` so the next phase replaces it. It requests `requireInteraction` and `renotify`, but browsers may ignore both, so nothing relies on the notification staying on screen; the looping alarm and banner last until Next or End. The other notification helpers are in `map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider`.

`pomodoroSessionLifecycle.ts` connects the provider to ordered authentication cleanup in `packages/web/src/lib/session.ts`. Controller and storage contracts live in `pomodoroSessionController.test.ts` and `pomodoroSessionState.test.ts` beside the implementation. `e2e/timer-pomodoro-session.spec.ts` exercises restored sessions through the existing logout controls and belongs to the isolated instance project in `playwright.config.ts` because it changes time resolution.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [practice-end-sessions-through-lib-session](../interaction-and-state/practice-end-sessions-through-lib-session.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
- Related: [practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md)
- Related: [map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md)
- Related: [map-pomodoro-cycle-functions-in-packages-common](map-pomodoro-cycle-functions-in-packages-common.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:0
[2] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:map:0
[3] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:1
<!-- kk:citations:end -->
