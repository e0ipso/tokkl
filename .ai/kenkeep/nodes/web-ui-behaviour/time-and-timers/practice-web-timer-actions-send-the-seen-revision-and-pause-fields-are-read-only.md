---
type: practice
title: >-
  Web timer actions: send the seen revision, adopt the reply, fields read-only
  while paused
description: >-
  Start, Stop, Pause, Resume, Stop while paused and session actions post to the
  server; a 409 carries the current state; the bar edits nothing while paused.
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
Start, Stop, Pause, Resume, Stop while paused and the Pomodoro actions are timer actions (`packages/web/src/api/timerHooks.ts`). Pause (`usePauseTimer`) sends no revision. Start (`useStartTimer`, `POST /api/app/timer/start`), Stop (`useStopTimer`, `POST /api/app/timer/stop`), resume, discard (Stop while paused), Next phase and End session send the revision of the cached state. Every reply, and the body of a 409, goes through `acceptTimerState`, so the views show the server's state with no local guess. Do not add client-side chain or session bookkeeping; the pieces that were once kept per account in `localStorage` are gone.

An edit of the running entry, such as the description saved as the user clicks Next phase, moves the revision. `currentRevision` first waits for pending writes that can move the revision (`settleOtherWrites`) and reads the state again. `revisionToSend` then uses the fresh revision only if the session phase and the pause are the ones the user saw. Otherwise it sends the seen revision and lets the server answer with a conflict. Only mutations with `meta: MOVES_TIMER` (`api/timerState.ts`) count: every entry hook in `api/entries.ts`, and `useAction` calls passing `movesTimer: true` for edits of what the running entry shows (project, client, task and tag edits and deletes) and for imports. A new write that can change the running entry, its project, client, task or tags, or the session or pause must carry the mark. Preference, profile, password, workspace and admin saves carry none, so they never delay Resume or End session. Timer actions are unmarked, so an action never waits for itself. A marked write that TanStack holds for the connection (`isPaused`), such as an entry edit made offline, fails the wait at once with the `offline` error, so the action never goes out late after reconnect; an unmarked held write does not.

Failures become `TimerActionError` (`api/timerState.ts`): kind `conflict` for a 409 whose body is a timer state ("Another device changed the timer first."), and `offline` when fetch rejects or the request runs past its deadline (`RequestTimeoutError` from `api/client.ts`). Mutations use `networkMode: 'always'`, so an offline action fails at once instead of waiting and firing late. Start sends the draft's fields and an explicit `start` (the bar's `markOwnStart` second), and Continue and favorites use the same call, because the server stops a running entry at the new start. Stop sends an explicit `stop` from the server-corrected clock (`serverNow`). The reply is a timer state, not the stopped entry, so `useTimerBarActions` tells that the entry went to the trash ("Too short to keep") from `snappedSeconds(current.start, stop)` being 0: the revision vouches for the start it showed, and `snappedSeconds` snaps as the server does. Because both carry a revision, a Start or Stop after a write that got no reply needs no extra read: if that write landed, the revision moved and the server answers 409 with its state. Only the finished entry typed into the idle bar as a duration is still a v9 create, through `useAddTypedEntry` (`api/entries.ts`), with `networkMode: 'always'` and `attemptTimerRequest` (`api/timerState.ts`), which turns a TypeError into the `offline` error. Other creates (calendar, manual form, editor, duplicate) keep `useCreateEntry` and the default network mode. `api/timerHooks.test.ts` covers the Start and Stop requests and the adopted conflict state.

In the timer bar (`timerBarView` in `timerBarView.ts`, read by `TimerBar.tsx`), `paused` means a state with `pause.paused` and no running entry. The bar then shows the chain's fields (`pauseDraft` in `pauseView.ts`) in read-only inputs, because Resume starts a clone of what the server holds. The clock is `barSeconds`: the chain's `seconds` plus the clone's elapsed time while it runs, frozen while paused. Plain Stop on a running entry is the timer stop; the server ends the chain when the stopped entry is its clone. Chain and session rules live in the server (see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). Pausing is refused during a session.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-web-timer-state-stream-and-pomodoro-session-views](../pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md)
- Related: [practice-web-ui-survives-background-refetches](../interaction-and-state/practice-web-ui-survives-background-refetches.md)
<!-- kk:related:end -->
