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
The server owns one timer state per user: the running entry, a pause chain, or a Pomodoro session whose open pomodoro is the running entry. A state holds at most one of a chain and a session. Domain settlement and actions are in `packages/api/src/domain/timers.ts`; row access is in `storage/repositories/timers.ts`. `packages/api/src/routes/timer.ts` mounts them under `/api/app`. The `TimerState` type is in `packages/types/index.ts`.

Settlement is the rule that keeps the pieces consistent. `settleTimer` ends a session whose entry is not the running one, drops a chain whose clone is not the running entry (so a paused chain survives only while nothing runs), and compares the JSON of the running entry, session and chain with the fingerprint stored for the last revision. The fingerprint also holds the names and flags the state shows: the running entry's project (name, colour, active, billable), client name, task (name, active) and tag names, and the names of the chain's tags. If they differ, `revision` goes up by one and the hub (`timerHub.ts`) tells the stream after the commit. This is why a stop of the pomodoro entry through any client, including a plain Toggl client, ends the session, and why starting any other timer ends a chain.

Any write that can change a user's running entry must call `touchTimer(ctx, userId, publish)` inside its transaction. It defers settlement to just before commit and publishes only if the state changed. A write that skips it is still settled by the next read, because `getTimerState` and every action settle first, but nothing is pushed to streams until then. Writes that change other users' entries, such as deleting a project, task or tag, use the catalog timer effects from `createCatalogTimerEffects`. So do writes that change what their timers show: updating a client, project, task or tag, and archiving, restoring or deleting a client. Each calls it before its write, because deleting a project with its entries trashes the running ones it looks for. Chains store tag ids without a foreign key, so deleting a tag calls `removeTagFromPauseChains`.

Actions run in one transaction on the settled state. `pause` takes no revision. `resume`, `discard`, `next` and `end` take `{revision}`, and a stale one gets a 409 whose body is the current state (`ConflictWithBody`), as does any action the state refuses, such as pausing during a session. `POST /api/app/pomodoro` starts a session and takes no revision; it is refused while a session runs, and it ends any chain. A start body may override the four lengths for that session. Next phase from a rest to work stops the open pomodoro's entry at the confirm instant and starts the next one at the same instant with the same fields, so edits to the running entry carry over.

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
