---
type: practice
title: Password checks go through FailureLimiter.attempt
description: >-
  Password checks charge three counters; 429s send Retry-After; disabled
  accounts fail like bad passwords; new passwords use readNewPassword.
tags:
  - server
  - auth
  - rate-limit
kk_schema_version: 3
kk_id: practice-password-checks-go-through-failurelimiter-attempt
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Every password check runs inside `loginLimiter.attempt(passwordCounters(email, address), check)` (`FailureLimiter` in `packages/api/src/auth/rateLimit.ts`, built in `packages/api/src/app.ts`). `attempt` takes a plain key or a list of counters, charges a failure to every counter, and returns null without running scrypt once any counter is full. Checks still running hold a slot in each counter, and extra requests wait up to a counter's limit before being refused. `passwordCounters` returns three counters over a 15-minute window (`PASSWORD_WINDOW_MS`): account plus address (10, keyed by `JSON.stringify([account, address])` so pairs cannot collide), account (50) and address (100). A new code path that verifies a password must use `attempt`, not `verifyPassword` directly.

Every limiter refusal (form login, Basic auth, password change, setup codes, invite and password reset links) answers 429 through `tooManyRequests(message, seconds)` in `packages/api/src/lib/errors.ts`, which sets `Retry-After`. Take the seconds from `retryAfterSeconds(keys)` on the same limiter and keys, called after `attempt` returned null or `isBlocked` returned true. It returns the latest reset among the counters that are full, rounded up and clamped to 1 through the window (900 seconds), because an attempt is refused while any counter is full. `attempt` still returns `boolean | null` and does not carry the wait.

Sign-in checks for an account looked up by email use `verifyAccountPassword(user, password)` in `packages/api/src/auth/middleware.ts` as the `attempt` callback. A disabled account fails like a wrong password after the same scrypt run, so the limiter charges it and the response does not reveal the account. After a successful check, authorize with `currentActiveUser(db, user)`, which re-reads the row by id; a demotion or suspension made while scrypt ran then applies to that request. It also returns the account only when the stored `password_hash` equals the hash that was verified, so a reset or password change that committed during scrypt refuses the old password. Call it with no `await` before `startSession` or route entry; a reset deletes the account's sessions, and an await in between would let the old password still get one.

Form login (`routes/app.ts`), HTTP Basic auth (`auth/middleware.ts`) and the password change in the Toggl v9 `me` update (`routes/togglV9.ts`, charged to the caller's own email) all use these counters.

`PUT /me` with a password awaits scrypt twice (the current password, then the new hash). After the last await it calls `stillSignedIn(db, res.locals, user)` (`auth/middleware.ts`) and, when that is false, answers 403 and writes nothing. It is false when the account is gone or disabled, its hash changed, or the session or API token that authenticated the request no longer exists. API tests hold a scrypt result with `duringPasswordCheck(t, during)` in `packages/api/test/helpers.ts`, which runs `during` once after the next password check passes. `test/passwordChangeRace.test.ts` instead patches `node:crypto` `scrypt` and calls `syncBuiltinESMExports` to hold the Nth result; that only works in a file of its own, because `node --test` isolates files, and `./helpers.ts` is imported only after the patch. An unknown email still counts against its account and address and still costs a scrypt run through `verifyAgainstDummy`, so response time does not reveal which emails exist. A successful form login resets only `accountCounters` (account plus address, and account), never the address counter. Setup codes use a separate `setupLimiter` keyed by address (`SETUP_CODE_LIMIT`, 10).

Accounts are keyed by `normalizeEmail`: trim, then lowercase ASCII A-Z only. That matches SQLite `COLLATE NOCASE` on `users.email`. Do not use `toLowerCase`, which also folds letters such as Ä and would merge distinct users (`Ä@` and `ä@`) into one counter.

New passwords must be at least `MIN_PASSWORD_LENGTH` (8) and at most `MAX_PASSWORD_LENGTH` (1024) characters (`packages/api/src/auth/crypto.ts`). Current passwords are not capped on login, Basic auth or rotation, so an owner with an older, longer password can still sign in and change it.

New passwords from first-admin setup, invite accept, `PUT /me` and password reset all go through `readNewPassword` in `packages/api/src/auth/crypto.ts`; use it for any new path that sets one.

Invite and password reset link lookups (`GET` and `POST` on `/invites/:token` and `/password-resets/:token`, `routes/app.ts`) charge a miss to the address counter (`addressCounter`, the same 100-per-window counter login uses) and answer 429 before the lookup once it is full, so tokens cannot be guessed at speed. A successful reset clears `accountCounters` for that account and address.
