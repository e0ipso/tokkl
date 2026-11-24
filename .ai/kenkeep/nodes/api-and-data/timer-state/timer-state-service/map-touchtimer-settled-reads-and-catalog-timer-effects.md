---
type: map
title: 'touchTimer, settled reads and catalog timer effects'
description: >-
  Writes that can change a running entry call touchTimer; reads settle in a
  snapshot; catalog writes use catalog timer effects.
tags:
  - api
  - timer
kk_schema_version: 3
kk_id: map-touchtimer-settled-reads-and-catalog-timer-effects
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - map-timer-settlement-and-revision-fingerprint
  - map-asynchronous-ordered-timer-delivery-after-commit
  - map-timer-stream-credential-checks-and-recheck-after-credential-changes
  - map-timerbus-cross-instance-timer-delivery-to-sse-streams
kk_depends_on: []
kk_confidence: high
---
Any write that can change a user's running entry must call `touchTimer(ctx, userId, publish)` inside its transaction. It defers settlement to just before commit and publishes only if the state changed. A write that skips it is still settled by the next read, because `getTimerState` and every action settle first, but nothing is pushed to streams until then.

`getTimerState` (GET /api/app/timer, polls, stream opens) reads in a read snapshot and takes no guard. `settlementDue` in `timerSettlement.ts` says whether settling would write: a session or chain detached from the running entry, or a fingerprint that differs from the stored revision. Only then, or when the user or a workspace of the state is missing, does the read take the locked write path of an action, which settles, numbers and publishes. A settled read gives the same reply and revision as that path, publishes nothing, and does not wait behind imports or other writes holding the user's guards. Writes that change other users' entries, such as deleting a project, task or tag, use the catalog timer effects from `createCatalogTimerEffects`. So do writes that change what their timers show: updating a client, project, task or tag, and archiving, restoring or deleting a client. Each calls it before its write, because deleting a project with its entries trashes the running ones it looks for. Chains store tag ids without a foreign key, so deleting a tag calls `removeTagFromPauseChains`.

Guards bind settlement to the active transaction. Ordered local publication happens only after acknowledged commit and connection release. Account deletion synchronously retires cached stream identity before awaited credential rechecks, so an old group or build cannot leak state to a reused user id.

<!-- kk:related:start -->
# Related

- Related: [map-timer-settlement-and-revision-fingerprint](map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-asynchronous-ordered-timer-delivery-after-commit](../timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md)
- Related: [map-timer-stream-credential-checks-and-recheck-after-credential-changes](../timer-event-stream/map-timer-stream-credential-checks-and-recheck-after-credential-changes.md)
- Related: [map-timerbus-cross-instance-timer-delivery-to-sse-streams](../map-timerbus-cross-instance-timer-delivery-to-sse-streams.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
