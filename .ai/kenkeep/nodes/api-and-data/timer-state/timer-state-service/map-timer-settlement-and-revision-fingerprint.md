---
type: map
title: Timer settlement and revision fingerprint
description: >-
  settleTimer keeps the running entry, pause chain and Pomodoro session
  consistent and bumps the revision when the fingerprint changes.
tags:
  - api
  - timer
  - pomodoro
  - pause
kk_schema_version: 3
kk_id: map-timer-settlement-and-revision-fingerprint
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - practice-timer-stop-snapping-and-duration-limits
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-asynchronous-ordered-timer-delivery-after-commit
kk_depends_on: []
kk_confidence: high
---
The server owns one timer state per user: the running entry, a pause chain, or a Pomodoro session whose open pomodoro is the running entry. A state holds at most one of a chain and a session. Domain settlement is in `packages/api/src/domain/timerSettlement.ts` and actions are in `packages/api/src/domain/timers.ts`; row access is in `storage/repositories/timers.ts`. `packages/api/src/routes/timer.ts` mounts them under `/api/app`. The `TimerState` type is in `packages/types/index.ts`.

Settlement is the rule that keeps the pieces consistent. `settleTimer` ends a session whose entry is not the running one, drops a chain whose clone is not the running entry (so a paused chain survives only while nothing runs), and compares the JSON of the running entry, session and chain with the fingerprint stored for the last revision. `domain/timerFingerprint.ts` alone encodes that text, and the encoding must stay byte for byte what earlier servers stored. Nothing reads data back out of a fingerprint: it is only compared. The session entry a revision showed is stored next to it in `timer_states.session_entry_id` (migration 6 `timer_session_entry`, which filled it from the stored fingerprints), and settlement compares it with the next state to find a pomodoro the change sent to the trash. Anything else settlement needs from the last revision gets a column of its own. The fingerprint also holds the names and flags the state shows: the running entry's project (name, colour, active, billable), client name, task (name, active) and tag names, and the names of the chain's tags. If they differ, `revision` goes up by one and the timer publication (`createTimerPublication` in `services/timerDelivery.ts`) tells the stream after the commit. This is why a stop of the pomodoro entry through any client, including a plain Toggl client, ends the session, and why starting any other timer ends a chain.

Stops snap as any timer stop does (see `practice-timer-stop-snapping-and-duration-limits`). A pomodoro that rounds to zero lands in the trash, and `settleTimer` records it on the new revision as `discarded_pomodoro`, replacing whatever an earlier revision recorded. A pause that rounds to zero adds no seconds to the chain.

<!-- kk:related:start -->
# Related

- Related: [practice-timer-stop-snapping-and-duration-limits](../../time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-asynchronous-ordered-timer-delivery-after-commit](../timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
