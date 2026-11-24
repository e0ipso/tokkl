---
type: map
title: 'PomodoroSessionProvider: a tab-side view of the server''s Pomodoro session'
description: >-
  PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only
  post to the server; the browser stores no session state.
tags:
  - web
  - pomodoro
  - timer
kk_schema_version: 3
kk_id: map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session
kk_derived_from: []
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-pomodoro-cycle-functions-in-packages-common
  - map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
  - practice-end-sessions-through-lib-session
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-accepttimerstate-one-validated-entry-for-every-web-timer-state
kk_depends_on: []
kk_confidence: high
---
`PomodoroSessionProvider` (`components/PomodoroSessionProvider.tsx`) is a view of `state.pomodoro` plus what only a tab can do. It owns the alarm (`pomodoroSessionAlarm.ts`), the phase-end notification (`notifySessionPhaseEnd`) and the "This pomodoro was too short to save." toast, raised once per new `discarded_pomodoro` (`createDiscardNotices`). `start`, `nextPhase` and `end` only post to the server (`useStartPomodoro`, `useNextPhase`, `useEndPomodoro`); the server applies every session rule. A start sends the form's lengths as `work_minutes` and the other three fields for that session only, never writing preferences, and the cached revision, so a start against a timer that moved on gets a 409 whose state is adopted. The `/pomodoro` page (`pages/PomodoroPage.tsx`, with its parts in `pages/pomodoro/`) and `PomodoroSessionBanner` read this provider, so a session started on any device shows in every tab. The rings, countdown and overtime come from `phase.planned_end` and the server-corrected clock.

The browser keeps nothing about sessions or pauses: no `localStorage` keys, no Web Lock for saves, no retry queue. The only Web Lock left is the per-account audio lock in the alarm. Signing out clears the Query cache and leaves the session running on the server (see `practice-end-sessions-through-lib-session`). Actions need a connection; with none, an action fails at once with the offline message, while an active session keeps counting and ringing from the last state held.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-pomodoro-cycle-functions-in-packages-common](../map-pomodoro-cycle-functions-in-packages-common.md)
- Related: [map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider](../map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md)
- Related: [practice-end-sessions-through-lib-session](../../interaction-and-state/practice-end-sessions-through-lib-session.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-server-api-capabilities-and-pomodoro-limits-in-api-app-status](../../../api-and-data/timer-state/timer-state-service/map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-stoprunningentry-workspace-membership-check-on-every-stop](../../../api-and-data/timer-state/timer-state-service/map-stoprunningentry-workspace-membership-check-on-every-stop.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](../../../api-and-data/timer-state/timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-settlement-and-revision-fingerprint](../../../api-and-data/timer-state/timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-start-stop-and-edit-routes](../../../api-and-data/timer-state/timer-state-service/map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-touchtimer-settled-reads-and-catalog-timer-effects](../../../api-and-data/timer-state/timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
- Related: [map-accepttimerstate-one-validated-entry-for-every-web-timer-state](map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md)
<!-- kk:related:end -->
