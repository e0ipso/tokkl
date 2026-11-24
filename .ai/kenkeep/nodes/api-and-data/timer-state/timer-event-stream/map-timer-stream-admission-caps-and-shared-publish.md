---
type: map
title: Timer stream admission caps and shared publish
description: >-
  Timer streams cap at 10 per user and 1000 per process; one hub subscription
  per user; a publish builds state once.
tags:
  - api
  - timer
  - sse
kk_schema_version: 3
kk_id: map-timer-stream-admission-caps-and-shared-publish
kk_derived_from: []
kk_relates_to:
  - map-timer-stream-credential-checks-and-recheck-after-credential-changes
  - map-asynchronous-ordered-timer-delivery-after-commit
kk_depends_on: []
kk_confidence: high
---
A user may hold 10 streams (`maxPerUser`), and the process 1000 (`maxStreams`). Both count streams still opening, and admission runs before the credential check or the state build. An 11th stream for a user ends that user's oldest at once, even one still opening, which gets an empty response. A stream over the process cap gets a 503 `Too many timer streams, try again later` with `Retry-After: 5`, before any database read. A stream ended while it opens skips its check and build. One hub subscription serves all of a user's streams; the last stream to close drops it. A publish builds the state once for every passing stream. Building it settles the timer, which may commit and publish again, so a `publishing` flag skips that inner publish. `closeAll()` ends every stream so the server can shut down.

<!-- kk:related:start -->
# Related

- Related: [map-timer-stream-credential-checks-and-recheck-after-credential-changes](map-timer-stream-credential-checks-and-recheck-after-credential-changes.md)
- Related: [map-asynchronous-ordered-timer-delivery-after-commit](map-asynchronous-ordered-timer-delivery-after-commit.md)
<!-- kk:related:end -->
