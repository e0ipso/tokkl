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
kk_derived_from: []
kk_relates_to:
  - practice-theme-tokens-data-theme-and-cached-theme
  - practice-web-ui-survives-background-refetches
  - practice-password-checks-and-csrf-rules
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/lib/session.ts` owns the end of a session. `endSession(qc)` clears the TanStack Query cache, the cached theme (`clearCachedTheme`) and any pending logout-failure flag, so the login page and the next user start clean in the system theme. Do not clear these pieces separately elsewhere.

`logOut(qc)` posts `/api/app/logout` and calls `endSession` whether or not the request succeeds. On failure it also sets a `sessionStorage` flag and rethrows; either way the callers load a fresh page (`App.tsx` sets `window.location.href = '/'`, `pages/SettingsPage.tsx` reloads). After that load the app is still signed in, and `takeLogoutFailure()` in `App.tsx` turns the flag into an error toast that stays for 60 seconds.

`useEndSessionOnForbidden` in `App.tsx` calls `endSession` when `/me` answers 403, inside a layout effect so the login page never paints in the previous user's theme. It fires once and re-arms only after a successful `/me`; the second 403 that follows the cleared cache does nothing, which prevents a clear-and-refetch loop. A logged-out page load therefore requests `/api/v9/me` twice, and `e2e/theme.spec.ts` asserts exactly that.

`qc.clear()` does not notify mounted queries. They keep showing their last result until their component renders again, and later cache operations do not reach them. After `endSession`, either reload the page or re-render the components that read the cleared queries.

<!-- kk:related:start -->
# Related

- Related: [practice-theme-tokens-data-theme-and-cached-theme](../web-ui-styling-and-layout/practice-theme-tokens-data-theme-and-cached-theme.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [practice-password-checks-and-csrf-rules](../api-and-data/practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
