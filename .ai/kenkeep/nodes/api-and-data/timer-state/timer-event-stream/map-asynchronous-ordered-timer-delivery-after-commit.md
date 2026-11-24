---
type: map
title: Asynchronous ordered timer delivery after commit
description: >-
  A timer write enqueues its state on an ordered per-user queue after commit and
  never waits for stream delivery.
tags:
  - api
  - timer
  - sse
kk_schema_version: 3
kk_id: map-asynchronous-ordered-timer-delivery-after-commit
kk_derived_from: []
kk_relates_to:
  - map-timerbus-cross-instance-timer-delivery-to-sse-streams
  - map-timer-settlement-and-revision-fingerprint
  - map-touchtimer-settled-reads-and-catalog-timer-effects
kk_depends_on: []
kk_confidence: high
---
A write does not wait for its stream delivery. The commit's after-commit hook hands the state to `publish` in `services/timerDelivery.ts`, which enqueues it on the user's ordered queue (`createTimerPublication`), signals the bus and returns, so the reply never waits for credential checks or for a keep-alive tick holding the user's stream queue. Deliveries still run one at a time per user, in commit order, and a failed one is logged (`Timer delivery failed`). A client can therefore get the reply before the stream sends that state, or after it sends an older one still queued. Revisions make that harmless: a stream only sends a revision above the last it sent, and the web client (`planTimerUpdate`) and the desktop core (`TimerStateClient::adopt`) drop a state older than the one they hold. Keep both rules if either side changes. Shutdown (`close` in `services/application.ts`) waits for running deliveries and refreshes before it closes the streams, so committed states reach open streams, and again after, before storage closes. Tests that need a delivery to have happened wait for the stream event, not for the reply.

<!-- kk:related:start -->
# Related

- Related: [map-timerbus-cross-instance-timer-delivery-to-sse-streams](../map-timerbus-cross-instance-timer-delivery-to-sse-streams.md)
- Related: [map-timer-settlement-and-revision-fingerprint](../timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-touchtimer-settled-reads-and-catalog-timer-effects](../timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
<!-- kk:related:end -->
