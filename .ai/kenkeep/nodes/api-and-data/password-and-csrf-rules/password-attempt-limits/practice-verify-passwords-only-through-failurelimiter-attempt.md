---
type: practice
title: Verify passwords only through FailureLimiter.attempt
description: >-
  Password checks run in loginLimiter.attempt over three counters; refusals
  answer 429 with Retry-After; never call verifyPassword directly.
tags:
  - server
  - auth
  - rate-limit
kk_schema_version: 3
kk_id: practice-verify-passwords-only-through-failurelimiter-attempt
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to:
  - practice-charge-invite-and-reset-link-misses-to-the-address-counter
  - practice-recheck-credentials-inside-the-guarded-account-transaction
  - practice-key-login-rate-limits-with-normalizeemail-not-tolowercase
kk_depends_on:
  - >-
    practice-share-password-rate-limits-through-database-counters-and-reservations
kk_confidence: high
---
Every password check runs inside `loginLimiter.attempt(passwordCounters(email, address), check)` (`FailureLimiter` in `packages/api/src/auth/rateLimit.ts`, built in `packages/api/src/app.ts` over `storage.rateLimits`). `attempt` takes a plain key or a list of counters and charges a failure to every counter when the check returns false. A new code path that verifies a password must use `attempt`, not `verifyPassword` directly. `passwordCounters` returns three counters over a 15-minute window (`PASSWORD_WINDOW_MS`): account plus address (10, keyed by `JSON.stringify([account, address])` so pairs cannot collide), account (50) and address (100).

Every limiter refusal (form login, Basic auth, password change, email change, setup codes, invite and password reset links) answers 429 through `tooManyAttempts(message, seconds)` in `packages/api/src/lib/errors.ts`, whose seconds `packages/api/src/http/errors.ts` sends as `Retry-After`. The seconds come from the refused `attempt`. Setup codes and invite and reset links also run their comparison or lookup through `attempt`, so parallel misses cannot pass a limit before their failures are recorded. Use `attempt` for any new failure-counted check; there is no separate check-then-record API.

Form login (`auth/sessions.ts`, mounted in `routes/app.ts`), HTTP Basic auth (`auth/middleware.ts`) and the password and email changes in the Toggl v9 `me` update (`routes/toggl/me.ts`, charged to the caller's own email) all use these counters. Both reach `updateProfile` in `domain/accounts.ts` through the `AccountPasswordAttempt` port, which `passwordAttempt` builds, and `verifyProfileUpdate` charges at most one failure per request. A session or API-token email change with no `current_password` is refused before `attempt` and is not charged; password Basic needs no `current_password` for it, because the request already went through the limiter.

An unknown email still counts against its account and address and still costs a scrypt run through `verifyAgainstDummy`, so response time does not reveal which emails exist. A successful form login resets only `accountCounters` (account plus address, and account), never the address counter. Setup codes use the separate `setupLimiter` keyed by address (`SETUP_CODE_LIMIT`, 10). The setup code itself stays in process memory; only its wrong-guess counter is in the database.

<!-- kk:related:start -->
# Related

- Related: [practice-charge-invite-and-reset-link-misses-to-the-address-counter](practice-charge-invite-and-reset-link-misses-to-the-address-counter.md)
- Related: [practice-recheck-credentials-inside-the-guarded-account-transaction](practice-recheck-credentials-inside-the-guarded-account-transaction.md)
- Related: [practice-key-login-rate-limits-with-normalizeemail-not-tolowercase](practice-key-login-rate-limits-with-normalizeemail-not-tolowercase.md)
- Depends on: [practice-share-password-rate-limits-through-database-counters-and-reservations](practice-share-password-rate-limits-through-database-counters-and-reservations.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
