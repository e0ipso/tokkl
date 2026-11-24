---
type: map
title: 'Timer event stream protocol, keep-alive and proxy requirements'
description: >-
  GET /api/app/timer/events sends full state on connect and change, a keep-alive
  event every 25 s, and needs unbuffered proxies.
tags:
  - api
  - timer
  - sse
kk_schema_version: 3
kk_id: map-timer-event-stream-protocol-keep-alive-and-proxy-requirements
kk_derived_from: []
kk_relates_to:
  - map-timer-stream-credential-checks-and-recheck-after-credential-changes
  - map-timer-stream-backpressure-for-slow-clients
kk_depends_on: []
kk_confidence: high
---
`TimerStreams` (`packages/api/src/services/timerStreams.ts`) serves `GET /api/app/timer/events` as Server-Sent Events. Each stream gets `event: timer` with the full `TimerState` on connect and after every committed change for that user, and an `event: keep-alive` with empty data every 25 s (`keepAliveMs`). The 25 s and the other stream limits are `DEFAULT_TIMER_STREAM_LIMITS`, which reach the streams as `settings.timerStreams` of `DEFAULT_SERVICE_SETTINGS`, the settings `index.ts` passes to `createApplicationServices`; tests change them with `streamSettings` in `test/fixtures/app.ts`. It is an event rather than an SSE comment because a browser `EventSource` never surfaces comments, and the web client needs to see it to detect a silent stream. The response sets `X-Accel-Buffering: no`, `Cache-Control: no-store` and `Connection: close`. The first state is built before the headers go out, so a refused credential or an error still gets the normal JSON error reply. The first event also carries `retry:`, a random whole number of milliseconds from 5000 to 15000 (`RECONNECT_DELAY_MS`), placed after the `event:` line so readers that split on lines still see the type first; it spreads the browsers' built-in reconnects after a restart. Later events leave it out.

Operators must keep reverse proxies from buffering this response and give it a read timeout well above 25 s; the README shows an nginx block. A proxy that closes silent connections early makes web and desktop clients fall back to polling every 30 s. A stream that stays open but delivers nothing for 60 s, as behind a buffering proxy, counts as down on both: the web `connectTimerStream` closes its source and opens a new one after the same backoff as an error (`retryDelay`), and the desktop `NetworkStream` idle timer ends the stream.

<!-- kk:related:start -->
# Related

- Related: [map-timer-stream-credential-checks-and-recheck-after-credential-changes](map-timer-stream-credential-checks-and-recheck-after-credential-changes.md)
- Related: [map-timer-stream-backpressure-for-slow-clients](map-timer-stream-backpressure-for-slow-clients.md)
<!-- kk:related:end -->
