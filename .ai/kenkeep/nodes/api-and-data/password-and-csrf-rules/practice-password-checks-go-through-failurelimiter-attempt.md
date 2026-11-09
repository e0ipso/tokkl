---
type: practice
title: Password checks go through FailureLimiter.attempt
description: >-
  Password checks charge three counters; 429s send Retry-After; disabled
  accounts fail like bad passwords; new passwords use parseNewPassword.
tags:
  - server
  - auth
  - rate-limit
kk_schema_version: 3
kk_id: practice-password-checks-go-through-failurelimiter-attempt
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Every password check runs inside `loginLimiter.attempt(passwordCounters(email, address), check)` (`FailureLimiter` in `packages/api/src/auth/rateLimit.ts`, built in `packages/api/src/app.ts` over `storage.rateLimits`). `attempt` takes a plain key or a list of counters and charges a failure to every counter when the check returns false. A new code path that verifies a password must use `attempt`, not `verifyPassword` directly. `passwordCounters` returns three counters over a 15-minute window (`PASSWORD_WINDOW_MS`): account plus address (10, keyed by `JSON.stringify([account, address])` so pairs cannot collide), account (50) and address (100).

The counters live in the database, in `rate_limit_counters` and `rate_limit_reservations`, so every instance on one database shares the same limits and a restart keeps them. Every limiter method is async. A refused reservation keeps no counter row it created. Reservations and checks never delete expired rows: an expired reservation holds no slot and an ended window counts no failures, so stale rows change no answer. The hourly maintenance job (`runMaintenance` in `services/maintenance.ts`) calls `rateLimits.deleteExpired` in batches of 500 per table, skipping locked rows. `FailureLimiter` takes `RateLimitChecks` (reserve, release, reset), not the cleanup. The stored key is ``sha256(`${namespace}:${key}`)``, with namespace `password` for `loginLimiter` and `setup-code` for `setupLimiter`, so the tables hold no email or IP address and the two limiters never share a counter.

Before the check runs, `attempt` reserves one slot in each counter: a reservation row with its own `expires_at`, 60 seconds after the reserve (`RESERVATION_LEASE_MS`). A counter refuses when its failures plus its live reservations reach its limit, so parallel requests cannot all start scrypt before the first failure is recorded. The check runs with no transaction open. The slots are released in `finally`, and a failed check adds its failure in the same write. A thrown check releases and records nothing. A reservation from an instance that died expires on its own, and expired rows are deleted inside later limiter writes.

`attempt` returns `{ refused: false, valid }` after running the check, or `{ refused: true, retryAfter }` without running it. A blocked counter gives the latest reset among the full counters, rounded up and clamped to 1 through the window (900 seconds), because an attempt is refused while any counter is full. When no counter is full but reservations fill a slot, the attempt is refused at once with `retryAfter` 1. There is no wait queue, because one instance cannot wake a waiter on another.

Every limiter refusal (form login, Basic auth, password change, setup codes, invite and password reset links) answers 429 through `tooManyAttempts(message, seconds)` in `packages/api/src/lib/errors.ts`, whose seconds `packages/api/src/http/errors.ts` sends as `Retry-After`. The seconds come from the refused `attempt`. Setup codes and invite and reset links also run their comparison or lookup through `attempt`, so parallel misses cannot pass a limit before their failures are recorded. Use `attempt` for any new failure-counted check; there is no separate check-then-record API.

Authentication in `auth/middleware.ts` runs password verification through the limiter, then asynchronously re-reads the active account and verified credential identity. Session creation and protected mutations recheck credentials inside the guarded transaction. A suspension, deletion, password reset or token/session revocation committed while scrypt or lock acquisition waits must refuse the stale credential.

Form login (`auth/sessions.ts`, mounted in `routes/app.ts`), HTTP Basic auth (`auth/middleware.ts`) and the password change in the Toggl v9 `me` update (`routes/toggl/me.ts`, charged to the caller's own email) all use these counters. The password change reaches `updateProfile` in `domain/accounts.ts` through the `AccountPasswordAttempt` port, which `passwordAttempt` builds.

`PUT /me` password rotation validates the current credential again under the protected account transaction after hashing. `createApplicationServices` in `services/application.ts` composes these guarded rechecks; no synchronous no-await window is assumed. API race tests hold actual crypto work or guard acquisition to prove revocation. An unknown email still counts against its account and address and still costs a scrypt run through `verifyAgainstDummy`, so response time does not reveal which emails exist. A successful form login resets only `accountCounters` (account plus address, and account), never the address counter. A reset clears failures but leaves reservations of checks still running. Setup codes use the separate `setupLimiter` keyed by address (`SETUP_CODE_LIMIT`, 10). The setup code itself stays in process memory; only its wrong-guess counter is in the database.

Accounts are keyed by `normalizeEmail`: trim, then lowercase ASCII A-Z only. That matches the `users.email_key` column, which folds the same letters on every engine. Do not use `toLowerCase`, which also folds letters such as Ä and would merge distinct users (`Ä@` and `ä@`) into one counter.

New passwords must be at least `MIN_PASSWORD_LENGTH` (8) and at most `MAX_PASSWORD_LENGTH` (1024) characters (`packages/api/src/domain/accountValues.ts`). Current passwords are not capped on login, Basic auth or rotation, so an owner with an older, longer password can still sign in and change it.

New passwords from first-admin setup, invite accept, `PUT /me` and password reset all go through `parseNewPassword` in `packages/api/src/commands/accounts.ts`; use it for any new path that sets one.

Invite and password reset link lookups (`GET` and `POST` on `/invites/:token` and `/password-resets/:token`, `routes/app.ts`) charge a miss to the address counter (`addressCounter`, the same 100-per-window counter login uses) and answer 429 before the lookup once it is full, so tokens cannot be guessed at speed. A successful reset clears `accountCounters` for that account and address.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
