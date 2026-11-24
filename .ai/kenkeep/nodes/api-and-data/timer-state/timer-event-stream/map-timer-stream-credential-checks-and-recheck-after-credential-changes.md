---
type: map
title: Timer stream credential checks and recheck after credential changes
description: >-
  Each timer stream keeps re-checking the credential that opened it, shared per
  credential key; credential-ending routes call recheck.
tags:
  - api
  - timer
  - sse
  - auth
kk_schema_version: 3
kk_id: map-timer-stream-credential-checks-and-recheck-after-credential-changes
kk_derived_from: []
kk_relates_to:
  - practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
  - map-touchtimer-settled-reads-and-catalog-timer-effects
kk_depends_on: []
kk_confidence: high
---
Each stream carries a check, `credentialCheck` in `services/timerDelivery.ts`, that must keep passing for the credential that opened it (cookie session, API token or password). It runs before each state send and on each keep-alive tick, and a failing stream is ended. Code that can end a credential also calls `timerStreams.recheck(userId)` after it commits, so the stream closes at once rather than at the next tick: logout, token rotation, password change or reset, suspension, account deletion and session revocation. Add the call to any new route that ends a credential. A check that throws, such as on a closed database, counts as a failure.

Checks are shared per credential, not run per stream. `openTimerStream` passes `credentialKey(authentication)`, a SHA-256 of the user id, the verified password hash, the credential kind and the presented token (the API token for a password): two checks with one key always agree. A user's streams have one keep-alive timer, and each keep-alive tick, publish and `recheck` runs one check per key, in order, and applies the result to every stream holding that key. A failing key ends all of them. A stream opened without a key (tests, or `TimerStreams.open` called directly) is checked alone.

<!-- kk:related:start -->
# Related

- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
- Related: [map-touchtimer-settled-reads-and-catalog-timer-effects](../timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
<!-- kk:related:end -->
