---
type: practice
title: Password checks go through FailureLimiter.attempt; writes need the CSRF header
description: >-
  Password checks charge account+address, account and address counters; new
  passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1.
tags:
  - server
  - auth
  - security
  - rate-limit
  - csrf
kk_schema_version: 3
kk_id: practice-password-checks-and-csrf-rules
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Every password check runs inside `loginLimiter.attempt(passwordCounters(email, address), check)` (`FailureLimiter` in `packages/api/src/auth/rateLimit.ts`, built in `packages/api/src/app.ts`). `attempt` takes a plain key or a list of counters, charges a failure to every counter, and returns null without running scrypt once any counter is full; callers answer 429. Checks still running hold a slot in each counter, and extra requests wait up to a counter's limit before being refused. `passwordCounters` returns three counters over a 15-minute window (`PASSWORD_WINDOW_MS`): account plus address (10, keyed by `JSON.stringify([account, address])` so pairs cannot collide), account (50) and address (100). A new code path that verifies a password must use `attempt`, not `verifyPassword` directly.

Form login (`routes/app.ts`), HTTP Basic auth (`auth/middleware.ts`) and the password change in the Toggl v9 `me` update (`routes/togglV9.ts`, charged to the caller's own email) all use these counters. An unknown email still counts against its account and address and still costs a scrypt run through `verifyAgainstDummy`, so response time does not reveal which emails exist. A successful form login resets only `accountCounters` (account plus address, and account), never the address counter. Setup codes use a separate `setupLimiter` keyed by address (`SETUP_CODE_LIMIT`, 10).

Accounts are keyed by `normalizeEmail`: trim, then lowercase ASCII A-Z only. That matches SQLite `COLLATE NOCASE` on `users.email`. Do not use `toLowerCase`, which also folds letters such as Ä and would merge distinct users (`Ä@` and `ä@`) into one counter.

New passwords (first-admin setup and password change) are capped at `MAX_PASSWORD_LENGTH` (1024, `packages/api/src/auth/crypto.ts`). Current passwords are not capped on login, Basic auth or rotation, so an owner with an older, longer password can still sign in and change it.

Cookie-authenticated requests other than GET, HEAD and OPTIONS must send `X-Tokkl-CSRF: 1` (`hasCsrfHeader` in `packages/api/src/auth/middleware.ts`, which also accepts the pre-rename `X-Timetrack-CSRF: 1`); `packages/web/src/api/client.ts` always sends `X-Tokkl-CSRF`. `POST /logout` requires it when a session is active and stays idempotent without one.
