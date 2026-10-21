---
type: practice
title: End web sessions through endSession and logOut in lib/session.ts
description: >-
  Logout clears the Query cache and cached theme even on failure, then reloads;
  a 403 from /me ends the session once per sign-in.
tags:
  - web
  - auth
  - react-query
  - theme
kk_schema_version: 3
kk_id: practice-end-sessions-through-lib-session
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:1'
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:2'
kk_relates_to:
  - practice-theme-tokens-data-theme-and-cached-theme
  - practice-web-ui-survives-background-refetches
  - practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/lib/session.ts` owns the end of a session. `endSession(qc)` clears the TanStack Query cache, the cached theme (`clearCachedTheme`), the timer state and any pending logout-failure flag, so the login page and the next user start clean in the system theme. Do not clear these pieces separately elsewhere.

The timer state is the active Pomodoro session in memory (`forgetActivePomodoroSession` in `packages/web/src/components/pomodoroSessionLifecycle.ts`) and the tab's in-memory pause chain (`forgetTabChain` in `packages/web/src/components/tabChain.ts`), then the stored pause chains and Pomodoro sessions (`forgetChains`, `forgetPomodoroSessions`). The in-memory cleanup runs before and outside the storage `try`, so blocked storage cannot skip it. A chain that storage refused lives only in that memory slot, so without this, signing in to the same account again in the same tab with no reload (after a 403 from `/me`) would bring back a pause from the ended session.

`logOut(qc)` first awaits `finishPomodoroSession()`, then posts `/api/app/logout` and calls `endSession` whether or not the request succeeds. The final Pomodoro entry save runs before authentication is revoked. The provider reports a failed save, closes queued operations and allows logout to proceed; the session is discarded rather than retried. On logout-request failure it also sets a `sessionStorage` flag and rethrows; either way the callers load a fresh page (`App.tsx` sets `window.location.href = '/'`, `pages/SettingsPage.tsx` reloads). After that load the app is still signed in, and `takeLogoutFailure()` in `App.tsx` turns the flag into an error toast that stays for 60 seconds.

`useEndSessionOnForbidden` in `App.tsx` calls `endSession` when `/me` answers 403, inside a layout effect so the login page never paints in the previous user's theme. It fires once and re-arms only after a successful `/me`; the second 403 that follows the cleared cache does nothing, which prevents a clear-and-refetch loop. A logged-out page load therefore requests `/api/v9/me` twice, and `e2e/theme.spec.ts` asserts exactly that.

`qc.clear()` does not notify mounted queries. They keep showing their last result until their component renders again, and later cache operations do not reach them. After `endSession`, either reload the page or re-render the components that read the cleared queries.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-theme-tokens-data-theme-and-cached-theme](../web-ui-styling-and-layout/practice-theme-tokens-data-theme-and-cached-theme.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../api-and-data/password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:1
[2] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:2
<!-- kk:citations:end -->
