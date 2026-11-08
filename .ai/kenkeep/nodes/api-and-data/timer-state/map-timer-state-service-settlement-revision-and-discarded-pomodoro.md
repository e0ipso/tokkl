---
type: map
title: 'Timer state service: settlement, revision and the discarded pomodoro'
description: >-
  settleTimer numbers a user's running entry, pause chain and Pomodoro session;
  every write that can change the running entry calls touchTimer.
tags:
  - api
  - timer
  - pomodoro
  - pause
kk_schema_version: 3
kk_id: map-timer-state-service-settlement-revision-and-discarded-pomodoro
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
kk_depends_on: []
kk_confidence: high
---
The server owns one timer state per user: the running entry, a pause chain, or a Pomodoro session whose open pomodoro is the running entry. A state holds at most one of a chain and a session. Domain settlement is in `packages/api/src/domain/timerSettlement.ts` and actions are in `packages/api/src/domain/timers.ts`; row access is in `storage/repositories/timers.ts`. `packages/api/src/routes/timer.ts` mounts them under `/api/app`. The `TimerState` type is in `packages/types/index.ts`.

Settlement is the rule that keeps the pieces consistent. `settleTimer` ends a session whose entry is not the running one, drops a chain whose clone is not the running entry (so a paused chain survives only while nothing runs), and compares the JSON of the running entry, session and chain with the fingerprint stored for the last revision. The fingerprint also holds the names and flags the state shows: the running entry's project (name, colour, active, billable), client name, task (name, active) and tag names, and the names of the chain's tags. If they differ, `revision` goes up by one and the timer publication (`services/timerPublication.ts`) tells the stream after the commit. This is why a stop of the pomodoro entry through any client, including a plain Toggl client, ends the session, and why starting any other timer ends a chain.

Any write that can change a user's running entry must call `touchTimer(ctx, userId, publish)` inside its transaction. It defers settlement to just before commit and publishes only if the state changed. A write that skips it is still settled by the next read, because `getTimerState` and every action settle first, but nothing is pushed to streams until then.

`getTimerState` (GET /api/app/timer, polls, stream opens) reads in a read snapshot and takes no guard. `settlementDue` in `timerSettlement.ts` says whether settling would write: a session or chain detached from the running entry, or a fingerprint that differs from the stored revision. Only then, or when the user or a workspace of the state is missing, does the read take the locked write path of an action, which settles, numbers and publishes. A settled read gives the same reply and revision as that path, publishes nothing, and does not wait behind imports or other writes holding the user's guards. Writes that change other users' entries, such as deleting a project, task or tag, use the catalog timer effects from `createCatalogTimerEffects`. So do writes that change what their timers show: updating a client, project, task or tag, and archiving, restoring or deleting a client. Each calls it before its write, because deleting a project with its entries trashes the running ones it looks for. Chains store tag ids without a foreign key, so deleting a tag calls `removeTagFromPauseChains`.

Actions run in one transaction on the settled state. The action builds its reply once, in `ctx.readAtCommit`: the runner calls it after every before-commit hook has run, settlements and hooks a wrapping transaction added included, so the reply is the state the transaction commits. Nothing changes the reply after that. `pause` takes no revision. `resume`, `discard`, `next` and `end` take `{revision}`, and a stale one gets a 409 whose body is the current state (`StateConflict`), as does any action the state refuses, such as pausing during a session. `POST /api/app/pomodoro` starts a session and takes no revision; it is refused while a session runs, and it ends any chain. A start body may override the four lengths for that session. Next phase from a rest to work stops the open pomodoro's entry at the confirm instant and starts the next one at the same instant with the same fields, so edits to the running entry carry over.

`POST /api/app/timer/start` and `POST /api/app/timer/stop` take `{revision}` too and answer the committed `TimerState`. Start takes the v9 entry fields, an optional `workspace_id` and an optional `start`, and runs `createTimeEntry`, so a running timer stops at the new start and its session or chain ends in settlement. Stop takes an optional `stop` and runs `stopEntryAt` on the running entry; with nothing running it gets the 409. They give the web app a timer reply for Start and Stop; the v9 entry routes still do the same writes and answer the entry.

Stops snap as any timer stop does (see `practice-stopped-entries-snap-to-the-time-resolution-on-write`). A pomodoro that rounds to zero lands in the trash, and `settleTimer` records it on the new revision as `discarded_pomodoro`, replacing whatever an earlier revision recorded. A pause that rounds to zero adds no seconds to the chain.

Guards bind settlement to the active transaction. Ordered local publication happens only after acknowledged commit and connection release. Account deletion synchronously retires cached stream identity before awaited credential rechecks, so an old group or build cannot leak state to a reused user id.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap](map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
