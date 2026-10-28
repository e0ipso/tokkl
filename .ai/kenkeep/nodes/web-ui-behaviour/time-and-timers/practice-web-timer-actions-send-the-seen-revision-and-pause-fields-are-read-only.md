---
type: practice
title: >-
  Web timer actions: send the seen revision, adopt the reply, fields read-only
  while paused
description: >-
  Pause, Resume, Stop while paused and session actions post to the server; a 409
  carries the current state; the bar edits nothing while paused.
tags:
  - web
  - timer
  - pause
  - pomodoro
kk_schema_version: 3
kk_id: >-
  practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-web-timer-state-stream-and-pomodoro-session-views
  - practice-web-ui-survives-background-refetches
kk_depends_on: []
kk_confidence: high
---
Pause, Resume, Stop while paused and the Pomodoro actions are server calls (`packages/web/src/api/timerHooks.ts`). Pause (`usePauseTimer`) sends no revision. Resume, discard (Stop while paused), Next phase and End session send the revision of the cached state. Every reply, and the body of a 409, goes through `acceptTimerState`, so the views show the server's state with no local guess. Do not add client-side chain or session bookkeeping; the pieces that were once kept per account in `localStorage` are gone.

An edit of the running entry, such as the description saved as the user clicks Next phase, moves the revision. `currentRevision` first waits for other pending writes (`settleOtherWrites`) and reads the state again. `revisionToSend` then uses the fresh revision only if the session phase and the pause are the ones the user saw. Otherwise it sends the seen revision and lets the server answer with a conflict. Keep timer actions out of that wait by giving them `TIMER_ACTION_KEY`.

Failures become `TimerActionError` (`api/timerState.ts`): kind `conflict` for a 409 whose body is a timer state ("Another device changed the timer first."), and `offline` when fetch rejects. Mutations use `networkMode: 'always'`, so an offline action fails at once instead of waiting and firing late.

In `TimerBar.tsx`, `paused` means a state with `pause.paused` and no running entry. The bar then shows the chain's fields (`pauseDraft` in `pauseView.ts`) in read-only inputs, because Resume starts a clone of what the server holds. The clock is `barSeconds`: the chain's `seconds` plus the clone's elapsed time while it runs, frozen while paused. Plain Stop on a running entry is still a v9 stop; the server ends the chain when the stopped entry is its clone. Chain and session rules live in the server (see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). Pausing is refused during a session.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-web-timer-state-stream-and-pomodoro-session-views](../pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md)
- Related: [practice-web-ui-survives-background-refetches](../interaction-and-state/practice-web-ui-survives-background-refetches.md)
<!-- kk:related:end -->
