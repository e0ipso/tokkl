---
type: practice
title: Hand timers and Pomodoro sessions over at one captured instant
description: >-
  Session starts stop the running timer at the start instant; timer starts end
  the session first, all under the account lock.
tags:
  - web
  - pomodoro
  - timer
kk_schema_version: 3
kk_id: practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:1'
kk_relates_to:
  - practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock
  - map-web-pomodoro-sessions-provider-controller-and-account-state
  - practice-web-timer-bar-pause-chain-rules
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
A Pomodoro session and a regular timer never record overlapping time. Every handoff runs through the controller in `packages/web/src/components/pomodoroSessionController.ts` under the account lock (`withTimerOperationLock`), and both sides use one instant captured before the lock is requested.

- Starting a session: the provider's `beforeStart` reads `/api/v9/me/time_entries/current` under the lock and stops a running entry with `stop` set to the session start. A stop that rounds to zero goes to the trash and the toast offers Undo. It then clears the paused chain with `writeTabChain(accountId, null)`, which reaches other tabs and this tab's in-memory fallback.
- Starting a regular timer: `TimerBar` calls `startTimer(at, create)`, which ends and saves any session at `at` before creating the entry.
- A timer started elsewhere: when a refetched current entry appears, `observeTimer` ends the session at that entry's server `start`. It ignores entries this tab started (`localTimers`) and starts at or before the current pomodoro's start.
- Pausing: `pauseTimer` runs the timer bar's pause only when no session exists, because a session that won the lock has already stopped the timer.

<!-- kk:related:start -->
# Related

- Related: [practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md)
- Related: [map-web-pomodoro-sessions-provider-controller-and-account-state](map-web-pomodoro-sessions-provider-controller-and-account-state.md)
- Related: [practice-web-timer-bar-pause-chain-rules](practice-web-timer-bar-pause-chain-rules.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:1
<!-- kk:citations:end -->
