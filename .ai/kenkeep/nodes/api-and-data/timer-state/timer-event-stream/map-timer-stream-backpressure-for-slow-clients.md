---
type: map
title: Timer stream backpressure for slow clients
description: >-
  A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB
  unsent ends the stream.
tags:
  - api
  - timer
  - sse
kk_schema_version: 3
kk_id: map-timer-stream-backpressure-for-slow-clients
kk_derived_from: []
kk_relates_to:
  - map-timer-event-stream-protocol-keep-alive-and-proxy-requirements
kk_depends_on: []
kk_confidence: high
---
A slow client does not end its stream at the first full socket. When `res.write` returns false the stream waits for `drain` for up to 30 s (`drainTimeoutMs`) and ends only if the socket is still full then. While it waits, keep-alives are skipped and timer events are still written, but a stream may hold at most 64 KiB unsent (`maxBufferedBytes`): a write that would pass that ends the stream. A first write into an empty buffer always goes out, whatever its size.

<!-- kk:related:start -->
# Related

- Related: [map-timer-event-stream-protocol-keep-alive-and-proxy-requirements](map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md)
<!-- kk:related:end -->
