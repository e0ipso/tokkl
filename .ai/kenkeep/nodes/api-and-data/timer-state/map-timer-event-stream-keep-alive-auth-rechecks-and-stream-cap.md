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
`TimerStreams` (`packages/api/src/services/timerStreams.ts`) serves `GET /api/app/timer/events` as Server-Sent Events. Each stream gets `event: timer` with the full `TimerState` on connect and after every committed change for that user, and an `event: keep-alive` with empty data every 25 s (`KEEP_ALIVE_MS`). It is an event rather than an SSE comment because a browser `EventSource` never surfaces comments, and the web client needs to see it to detect a silent stream. The response sets `X-Accel-Buffering: no`, `Cache-Control: no-store` and `Connection: close`. The first state is built before the headers go out, so a refused credential or an error still gets the normal JSON error reply. The first event also carries `retry:`, a random whole number of milliseconds from 5000 to 15000 (`RECONNECT_DELAY_MS`), placed after the `event:` line so readers that split on lines still see the type first; it spreads the browsers' built-in reconnects after a restart. Later events leave it out.

Each stream carries a check, `credentialCheck` in `services/streamCredentials.ts`, that must keep passing for the credential that opened it (cookie session, API token or password). It runs before each state send and on each keep-alive tick, and a failing stream is ended. Code that can end a credential also calls `timerStreams.recheck(userId)` after it commits, so the stream closes at once rather than at the next tick: logout, token rotation, password change or reset, suspension, account deletion and session revocation. Add the call to any new route that ends a credential. A check that throws, such as on a closed database, counts as a failure.

Checks are shared per credential, not run per stream. `openTimerStream` passes `credentialKey(authentication)`, a SHA-256 of the user id, the verified password hash, the credential kind and the presented token (the API token for a password): two checks with one key always agree. A user's streams have one keep-alive timer, and each keep-alive tick, publish and `recheck` runs one check per key, in order, and applies the result to every stream holding that key. A failing key ends all of them. A stream opened without a key (tests, or `TimerStreams.open` called directly) is checked alone.

A user may hold 10 streams (`maxPerUser`), and the process 1000 (`maxStreams`). Both count streams still opening, and admission runs before the credential check or the state build. An 11th stream for a user ends that user's oldest at once, even one still opening, which gets an empty response. A stream over the process cap gets a 503 `Too many timer streams, try again later` with `Retry-After: 5`, before any database read. A stream ended while it opens skips its check and build. One hub subscription serves all of a user's streams; the last stream to close drops it. A publish builds the state once for every passing stream. Building it settles the timer, which may commit and publish again, so a `publishing` flag skips that inner publish. `closeAll()` ends every stream so the server can shut down.

A write does not wait for its stream delivery. The commit's after-commit hook hands the state to `publish` in `services/timerDelivery.ts`, which enqueues it on the user's ordered queue (`createTimerPublication`), signals the bus and returns, so the reply never waits for credential checks or for a keep-alive tick holding the user's stream queue. Deliveries still run one at a time per user, in commit order, and a failed one is logged (`Timer delivery failed`). A client can therefore get the reply before the stream sends that state, or after it sends an older one still queued. Revisions make that harmless: a stream only sends a revision above the last it sent, and the web client (`planTimerUpdate`) and the desktop core (`TimerStateClient::adopt`) drop a state older than the one they hold. Keep both rules if either side changes. Shutdown (`close` in `services/application.ts`) waits for running deliveries and refreshes before it closes the streams, so committed states reach open streams, and again after, before storage closes. Tests that need a delivery to have happened wait for the stream event, not for the reply.

A slow client does not end its stream at the first full socket. When `res.write` returns false the stream waits for `drain` for up to 30 s (`drainTimeoutMs`) and ends only if the socket is still full then. While it waits, keep-alives are skipped and timer events are still written, but a stream may hold at most 64 KiB unsent (`maxBufferedBytes`): a write that would pass that ends the stream. A first write into an empty buffer always goes out, whatever its size.

Operators must keep reverse proxies from buffering this response and give it a read timeout well above 25 s; the README shows an nginx block. A proxy that closes silent connections early makes web and desktop clients fall back to polling every 30 s. A stream that stays open but delivers nothing for 60 s, as behind a buffering proxy, counts as down on both: the web `connectTimerStream` closes and reopens its source, and the desktop `NetworkStream` idle timer ends the stream.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
<!-- kk:related:end -->
