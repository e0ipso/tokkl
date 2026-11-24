---
type: practice
title: Route timer writes through timerWrite and reconcile after an unknown outcome
description: >-
  After an unknown write outcome, the next timer write reads GET /api/app/timer
  first; a guarded write fails as a conflict if it moved.
tags:
  - web
  - timer
kk_schema_version: 3
kk_id: >-
  practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome
kk_derived_from: []
kk_relates_to:
  - >-
    practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply
  - >-
    practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id
  - practice-send-an-idempotency-key-with-every-create-the-server-keys
kk_depends_on: []
kk_confidence: high
---
Every write that starts, stops or changes what the timer shows goes through `timerWrite` (`api/timerHooks.ts`): the timer actions (inside `attemptTimerRequest`), the typed duration, running-entry edits and Discard (`useDiscardRunningEntry`). A failure counts as an unknown outcome (`isOutcomeUnknown` in `api/timerState.ts`) when fetch rejects, the deadline passes, the server answers 5xx, or a 2xx reply does not parse (`UnparsableReplyError` from `api/client.ts`) or decode (`DecodeError`, `UnreadableTimerStateError`). The error keeps its message, and the QueryClient is marked. The next timer write first reads `GET /api/app/timer` (`reconcileTimer`) and adopts it. If the read revision differs from the cached one, the lost write may have landed, and a write guarded with `refuse` (the default `TimerWriteGuard`) fails with the `conflict` error without being sent. A running-entry edit uses `adopt` and goes out anyway, because its `entry_id` lets the server judge. If the read fails, nothing is sent and the mark stays. The v9 writes carry no revision, so this read is what keeps a retried Discard from applying on top of a landed one. It cannot catch a duplicate finished entry, because a finished create does not move the revision; the typed entry relies on its `Idempotency-Key` instead (see `practice-send-an-idempotency-key-with-every-create-the-server-keys`). A 4xx is a refusal and marks nothing.

<!-- kk:related:start -->
# Related

- Related: [practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply](practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md)
- Related: [practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id](practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md)
- Related: [practice-send-an-idempotency-key-with-every-create-the-server-keys](practice-send-an-idempotency-key-with-every-create-the-server-keys.md)
<!-- kk:related:end -->
