---
type: map
title: 'Timer event stream: keep-alive, credential rechecks and the stream cap'
description: >-
  GET /api/app/timer/events sends the full state on connect and each change, a
  keep-alive every 25 s, and ends when the credential stops passing.
tags:
  - api
  - timer
  - sse
  - auth
kk_schema_version: 3
kk_id: map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
kk_depends_on: []
kk_confidence: high
---
`TimerStreams` (`packages/api/src/services/timerStreams.ts`) serves `GET /api/app/timer/events` as Server-Sent Events. Each stream gets `event: timer` with the full `TimerState` on connect and after every committed change for that user, and a `: keep-alive` comment every 25 s (`KEEP_ALIVE_MS`). The response sets `X-Accel-Buffering: no`, `Cache-Control: no-store` and `Connection: close`. The first state is built before the headers go out, so a refused credential or an error still gets the normal JSON error reply.

Each stream carries a check, `stillSignedIn` in `auth/middleware.ts`, that must keep passing for the credential that opened it (cookie session, API token or password). It runs before each state send and on each keep-alive tick, and a failing stream is ended. Code that can end a credential also calls `timerStreams.recheck(userId)` after it commits, so the stream closes at once rather than at the next tick: logout, token rotation, password change or reset, suspension, account deletion and session revocation. Add the call to any new route that ends a credential. A check that throws, such as on a closed database, counts as a failure.

A user may hold 10 streams (`MAX_STREAMS_PER_USER`). Opening an 11th ends the oldest. One hub subscription serves all of a user's streams; the last stream to close drops it. A publish builds the state once for every passing stream. Building it settles the timer, which may commit and publish again, so a `publishing` flag skips that inner publish. `closeAll()` ends every stream so the server can shut down.

Operators must keep reverse proxies from buffering this response and give it a read timeout well above 25 s; the README shows an nginx block. A proxy that closes silent connections early makes web and desktop clients fall back to polling every 30 s.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
<!-- kk:related:end -->
