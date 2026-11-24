---
type: map
title: 'Web timer event stream: up and down tracking, polling fallback and backoff'
description: >-
  One EventSource per tab; up only after a well-formed state; 30 s poll while
  down; jittered reconnect backoff from 5 s up to 60 s.
tags:
  - web
  - timer
  - sse
kk_schema_version: 3
kk_id: map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff
kk_derived_from: []
kk_relates_to:
  - map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
  - map-accepttimerstate-one-validated-entry-for-every-web-timer-state
kk_depends_on: []
kk_confidence: high
---
`TimerStateProvider` (`packages/web/src/api/TimerStateProvider.tsx`) opens one `EventSource` on `/api/app/timer/events` per tab, keyed by `me.id`, through `connectTimerStream` in `timerStream.ts`. Each `timer` event goes through `acceptTimerState` in `timerHooks.ts` (see `map-accepttimerstate-one-validated-entry-for-every-web-timer-state`).

`useTimerState` polls `GET /api/app/timer` every 30 s only while the stream is down, and refetches on focus. The stream reports up and down through `TimerStreamingContext`. The stream counts as up only from the first well-formed state a connection delivers (the server sends one right after the headers), not when it opens. It counts as down when it errs, when a `timer` event does not decode, or when it stays silent for 60 s. When the browser gives up after an error status (`readyState` CLOSED), after an event that does not decode, and after 60 s of silence, `connectTimerStream` closes the source and opens a new one after `retryDelay`: a random wait between 5 s and a ceiling that starts at 10 s and doubles with each failure in a row, capped at 60 s. A well-formed state resets the count. The 5 s floor matches the `Retry-After: 5` the server sends when its stream cap is full; `EventSource` exposes neither the status nor the headers of a refused connection, so the client cannot read the header itself. Replacing `EventSource` with a fetch reader would break the e2e helpers that wrap `window.EventSource` (`watchTimerTraffic`). `timerStream.test.ts` checks the schedule with an injected `random`. Silence counts as a failure like the others, so a tab behind a buffering proxy backs off instead of opening a new server stream every minute. Keep-alives restart the 60 s wait only on a connection that has already delivered a state, so one that only sends keep-alives does not pass for working. `api/timerStream.test.ts` drives this state machine with a fake `EventSource`. A stream that went down, or ended, triggers a read of the state, so a 403 there (credential gone) reaches `/me`.

<!-- kk:related:start -->
# Related

- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-asynchronous-ordered-timer-delivery-after-commit](../../../api-and-data/timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-event-stream-protocol-keep-alive-and-proxy-requirements](../../../api-and-data/timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-admission-caps-and-shared-publish](../../../api-and-data/timer-state/timer-event-stream/map-timer-stream-admission-caps-and-shared-publish.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-backpressure-for-slow-clients](../../../api-and-data/timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap → map-timer-stream-credential-checks-and-recheck-after-credential-changes](../../../api-and-data/timer-state/timer-event-stream/map-timer-stream-credential-checks-and-recheck-after-credential-changes.md)
- Related: [map-accepttimerstate-one-validated-entry-for-every-web-timer-state](map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md)
<!-- kk:related:end -->
