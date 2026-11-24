---
type: map
title: 'TimerBus: cross-instance timer delivery to SSE streams'
description: >-
  TimerBus carries {userId, revision} signals between API processes (PostgreSQL
  LISTEN/NOTIFY); receivers rebuild timer state from the DB.
tags:
  - api
  - timer
  - sse
  - multi-instance
  - postgres
kk_schema_version: 3
kk_id: map-timerbus-cross-instance-timer-delivery-to-sse-streams
kk_derived_from:
  - '89681365-91ec-41b0-a42d-a66a4f67ccf0:map:0'
kk_relates_to:
  - map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
kk_depends_on: []
kk_confidence: medium
---
The `TimerBus` port (`packages/api/src/domain/ports.ts`) lets a timer change committed on one API process reach the same user's SSE streams on every other process that shares the database. `startTimerBus` in `packages/api/src/storage/timerBus.ts` picks the transport from the storage backend, not from a setting: PostgreSQL gets a dedicated `LISTEN` connection on channel `tokkl_timer_signal` (application name `tokkl-timer-bus`, reconnect backoff 100 ms to 5 s); SQLite, MySQL and MariaDB get `createLocalTimerBus`, which sends and receives nothing. The test fixture `test/fixtures/app.ts` defaults to the local bus.

A signal carries only `{userId, revision}`, never timer data. Any database role can `NOTIFY`, so `parseSignal` drops every payload that is not exactly that shape with safe positive integers. In `services/timerDelivery.ts`, each local commit publishes to local streams and then sends a signal; a received signal calls `refresh`, which rebuilds the state from the database only when this process has streams for that user and the revision is newer than what it already delivered. `refresh` never sends on the bus, which stops echo loops (a PostgreSQL process also receives and drops its own notifications).

The 25 s keep-alive credential check also returns the user's timer revision. A stream that is behind the database catches up at that tick (`onBehind`), so a missed signal, a dropped listener, or a non-PostgreSQL multi-process setup still converges within one tick. Per-user state is tied to the account's incarnation (creation time), so a reused user id never receives a deleted account's timer state. On shutdown the bus closes after the streams, and the listener socket is destroyed at the deadline so an unresponsive database cannot keep the process alive.

When changing this, verify with `timerBusRefresh.test.ts` and `heartbeatRecovery.test.ts` (all four engines), `timerBusPostgres.test.ts`, and the two-real-process `timerBusProcesses.test.ts` on PostgreSQL (all under `packages/api/test/storage/`).

<!-- kk:related:start -->
# Related

- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-asynchronous-ordered-timer-delivery-after-commit](timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-event-stream-protocol-keep-alive-and-proxy-requirements](timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-admission-caps-and-shared-publish](timer-event-stream/map-timer-stream-admission-caps-and-shared-publish.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-backpressure-for-slow-clients](timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-credential-checks-and-recheck-after-credential-changes](timer-event-stream/map-timer-stream-credential-checks-and-recheck-after-credential-changes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-server-api-capabilities-and-pomodoro-limits-in-api-app-status](timer-state-service/map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-stoprunningentry-workspace-membership-check-on-every-stop](timer-state-service/map-stoprunningentry-workspace-membership-check-on-every-stop.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-settlement-and-revision-fingerprint](timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-start-stop-and-edit-routes](timer-state-service/map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-touchtimer-settled-reads-and-catalog-timer-effects](timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 89681365-91ec-41b0-a42d-a66a4f67ccf0:map:0
<!-- kk:citations:end -->
