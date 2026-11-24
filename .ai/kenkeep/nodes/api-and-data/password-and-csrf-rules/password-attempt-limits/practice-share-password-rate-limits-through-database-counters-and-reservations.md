---
type: practice
title: Share password rate limits through database counters and reservations
description: >-
  Limiter counters and reservation leases live in the database, keyed by hash;
  attempt refuses with retryAfter and never queues.
tags:
  - server
  - auth
  - rate-limit
  - storage
kk_schema_version: 3
kk_id: practice-share-password-rate-limits-through-database-counters-and-reservations
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to:
  - practice-verify-passwords-only-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
The counters live in the database, in `rate_limit_counters` and `rate_limit_reservations`, so every instance on one database shares the same limits and a restart keeps them. Every limiter method is async. A refused reservation keeps no counter row it created. Reservations and checks never delete expired rows: an expired reservation holds no slot and an ended window counts no failures, so stale rows change no answer. The hourly maintenance job (`runMaintenance` in `services/maintenance.ts`) calls `rateLimits.deleteExpired` in batches of 500 per table, skipping locked rows. `FailureLimiter` takes `RateLimitChecks` (reserve, release, reset), not the cleanup. The stored key is ``sha256(`${namespace}:${key}`)``, with namespace `password` for `loginLimiter` and `setup-code` for `setupLimiter`, so the tables hold no email or IP address and the two limiters never share a counter.

Before the check runs, `attempt` reserves one slot in each counter: a reservation row with its own `expires_at`, 60 seconds after the reserve (`RESERVATION_LEASE_MS`). A counter refuses when its failures plus its live reservations reach its limit, so parallel requests cannot all start scrypt before the first failure is recorded. The check runs with no transaction open. The slots are released in `finally`, and a failed check adds its failure in the same write. A thrown check releases and records nothing. A reservation from an instance that died expires on its own, and expired rows are deleted inside later limiter writes. A reset clears failures but leaves reservations of checks still running.

`attempt` returns `{ refused: false, valid }` after running the check, or `{ refused: true, retryAfter }` without running it. A blocked counter gives the latest reset among the full counters, rounded up and clamped to 1 through the window (900 seconds), because an attempt is refused while any counter is full. When no counter is full but reservations fill a slot, the attempt is refused at once with `retryAfter` 1. There is no wait queue, because one instance cannot wake a waiter on another.

<!-- kk:related:start -->
# Related

- Related: [practice-verify-passwords-only-through-failurelimiter-attempt](practice-verify-passwords-only-through-failurelimiter-attempt.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
