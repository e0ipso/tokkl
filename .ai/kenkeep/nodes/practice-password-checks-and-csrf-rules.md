---
type: practice
title: Password checks go through FailureLimiter.attempt; writes need the CSRF header
description: >-
  Login, Basic auth and password change share the per-address limiter; new
  passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
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
Every password check runs inside `loginLimiter.attempt(address, check)` (`FailureLimiter` in `server/src/auth/rateLimit.ts`, built in `server/src/app.ts` with 10 failures per 15 minutes). Form login, HTTP Basic auth and the password change in the Toggl v9 `me` update all share it. `attempt` reserves a slot for each check still running, lets up to 10 more requests per address wait, and returns null without running scrypt once the address is blocked; callers answer 429. Only a successful form login calls `reset`. A new code path that verifies a password must use `attempt`, not `verifyPassword` directly.

New passwords (owner setup and password change) are capped at `MAX_PASSWORD_LENGTH` (1024, `server/src/auth/crypto.ts`). Current passwords are not capped on login, Basic auth or rotation, so an owner with an older, longer password can still sign in and change it.

Cookie-authenticated requests other than GET, HEAD and OPTIONS must send `X-Timetrack-CSRF: 1` (`hasCsrfHeader` in `server/src/auth/middleware.ts`); `web/src/api/client.ts` always sends it. `POST /logout` requires it when a session is active and stays idempotent without one.
