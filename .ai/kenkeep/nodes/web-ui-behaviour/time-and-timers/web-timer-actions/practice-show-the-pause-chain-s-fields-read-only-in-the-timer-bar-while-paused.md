---
type: practice
title: Show the pause chain's fields read-only in the timer bar while paused
description: >-
  While paused, the timer bar shows the chain's fields read-only and a frozen
  clock; pausing is refused during a session.
tags:
  - web
  - timer
  - pause
kk_schema_version: 3
kk_id: practice-show-the-pause-chain-s-fields-read-only-in-the-timer-bar-while-paused
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - practice-web-ui-survives-background-refetches
kk_depends_on: []
kk_confidence: high
---
In the timer bar (`timerBarView` in `timerBarView.ts`, read by `TimerBar.tsx`), `paused` means a state with `pause.paused` and no running entry. The bar then shows the chain's fields (`pauseDraft` in `pauseView.ts`) in read-only inputs, because Resume starts a clone of what the server holds. The clock is `barSeconds`: the chain's `seconds` plus the clone's elapsed time while it runs, frozen while paused. Plain Stop on a running entry is the timer stop; the server ends the chain when the stopped entry is its clone. Chain and session rules live in the server (see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). Pausing is refused during a session.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-server-api-capabilities-and-pomodoro-limits-in-api-app-status](../../../api-and-data/timer-state/timer-state-service/map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-stoprunningentry-workspace-membership-check-on-every-stop](../../../api-and-data/timer-state/timer-state-service/map-stoprunningentry-workspace-membership-check-on-every-stop.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](../../../api-and-data/timer-state/timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-settlement-and-revision-fingerprint](../../../api-and-data/timer-state/timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-start-stop-and-edit-routes](../../../api-and-data/timer-state/timer-state-service/map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-touchtimer-settled-reads-and-catalog-timer-effects](../../../api-and-data/timer-state/timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
- Related: [practice-web-ui-survives-background-refetches](../../interaction-and-state/practice-web-ui-survives-background-refetches.md)
<!-- kk:related:end -->
