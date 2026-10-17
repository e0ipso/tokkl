---
type: practice
title: Cookie writes and session-starting routes need the CSRF header
description: >-
  Cookie writes, login, setup, invite accept and password reset need
  X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
tags:
  - server
  - auth
  - csrf
kk_schema_version: 3
kk_id: practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Cookie-authenticated requests other than GET, HEAD and OPTIONS must send `X-Tokkl-CSRF: 1` (`hasCsrfHeader` in `packages/api/src/auth/middleware.ts`, which also accepts the pre-rename `X-Timetrack-CSRF: 1`); `packages/web/src/api/client.ts` always sends `X-Tokkl-CSRF`. `POST /logout` requires it when a session is active and stays idempotent without one.

The routes that start a session need the header even though the caller is anonymous: `POST /login`, `POST /setup` and `POST /invites/:token` in `packages/api/src/routes/app.ts`. The server parses every body as JSON whatever its Content-Type, so a cross-site `<form enctype="text/plain">` can post valid credentials, and without the check it would sign the victim's browser into an account the attacker controls (login CSRF). `POST /password-resets/:token` starts no session but is an anonymous write, so it needs the header too. Each of the four calls `requireCsrfHeader(req)` first and answers 403 "Missing CSRF header" before any lookup, scrypt run or limiter charge; no cookie is set and an invite or reset link stays usable. Any new route that starts a session or writes must do the same, anonymous or not. Callers must send the header too: the API tests (`CSRF` in `packages/api/test/helpers.ts`), the e2e helpers, `scripts/screenshots.ts` and `bench/history.ts`. HTTP Basic requests carry no cookie and need none. `e2e/auth-browser.spec.ts` has a Chromium scenario that submits a real cross-site `text/plain` form and checks for the 403 and no cookie.
