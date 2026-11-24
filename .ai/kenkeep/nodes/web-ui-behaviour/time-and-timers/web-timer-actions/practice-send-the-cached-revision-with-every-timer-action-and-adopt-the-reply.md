---
type: practice
title: Send the cached revision with every timer action and adopt the reply
description: >-
  Timer and Pomodoro actions send the cached revision; replies and 409 bodies go
  through acceptTimerState; failures are TimerActionError.
tags:
  - web
  - timer
  - pause
  - pomodoro
kk_schema_version: 3
kk_id: practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-accepttimerstate-one-validated-entry-for-every-web-timer-state
  - practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer
  - >-
    practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome
kk_depends_on: []
kk_confidence: high
---
Start, Stop, Pause, Resume, Stop while paused and the Pomodoro actions are timer actions (`packages/web/src/api/timerHooks.ts`). Start (`useStartTimer`, `POST /api/app/timer/start`), Stop (`useStopTimer`, `POST /api/app/timer/stop`), Pause (`pauseTimer`, `POST /api/app/timer/pause`, `pause-revision`), resume, discard (Stop while paused), Pomodoro start (`startPomodoro`, `POST /api/app/pomodoro`), Next phase and End session send the revision of the cached state. Every reply, and the body of a 409, goes through `acceptTimerState` (see `map-accepttimerstate-one-validated-entry-for-every-web-timer-state`), so the views show the server's state with no local guess. Do not add client-side chain or session bookkeeping; nothing of it is kept per account in `localStorage`.

Failures become `TimerActionError` (`api/timerState.ts`): kind `conflict` for a 409 whose body is a timer state ("Another device changed the timer first."), and `offline` when fetch rejects or the request runs past its deadline (`RequestTimeoutError` from `api/client.ts`). Mutations use `networkMode: 'always'`, so an offline action fails at once instead of waiting and firing late. Start sends the draft's fields and an explicit `start` (the bar's `markOwnStart` second), and Continue and favorites use the same call, because the server stops a running entry at the new start. Stop sends an explicit `stop` from the server-corrected clock (`serverNow`). The reply is a timer state, not the stopped entry, so `useTimerBarActions` tells that the entry went to the trash ("Too short to keep") from `snappedSeconds(current.start, stop)` being 0: the revision vouches for the start it showed, and `snappedSeconds` snaps as the server does. Because both carry a revision, a Start or Stop after a write whose outcome is unknown is refused with a 409 and the server's state if that write landed. The finished entry typed into the idle bar as a duration is still a v9 create, through `useAddTypedEntry` (`api/entries.ts`), with `networkMode: 'always'` and `attemptTimerRequest` (`api/timerHooks.ts`), which turns a TypeError into the `offline` error. Other creates (calendar, manual form, editor, duplicate) keep `useCreateEntry` and the default network mode.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-server-api-capabilities-and-pomodoro-limits-in-api-app-status](../../../api-and-data/timer-state/timer-state-service/map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-stoprunningentry-workspace-membership-check-on-every-stop](../../../api-and-data/timer-state/timer-state-service/map-stoprunningentry-workspace-membership-check-on-every-stop.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](../../../api-and-data/timer-state/timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-settlement-and-revision-fingerprint](../../../api-and-data/timer-state/timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-start-stop-and-edit-routes](../../../api-and-data/timer-state/timer-state-service/map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-touchtimer-settled-reads-and-catalog-timer-effects](../../../api-and-data/timer-state/timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
- Related: [map-accepttimerstate-one-validated-entry-for-every-web-timer-state](../../pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md)
- Related: [practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer](practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md)
- Related: [practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md)
<!-- kk:related:end -->
