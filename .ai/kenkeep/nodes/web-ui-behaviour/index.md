# kenkeep Index: web-ui-behaviour

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #common
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) to learn about: Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch. #web #react-query #timer #entry-list
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) to learn about: Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in. #web #auth #react-query #theme
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #time #parsing
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) to learn about: Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets. #web #a11y #keyboard #react #reports
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) to learn about: navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand. #web #clipboard #self-hosting

## Components (what exists)
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) to learn about: PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too. #web #a11y #react #components #forms #e2e

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #a11y
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #react
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #react-query
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #time
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Parse incoming timestamps with parseInstant**](../api-and-data/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #auth
- Open [**Admin API and disabled accounts**](../api-and-data/map-admin-api-and-disabled-accounts.md) — /api/app/admin user list, role and disable changes, session revoke; last-active-admin rule; where disabled accounts are refused.
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](../api-and-data/practice-password-checks-and-csrf-rules.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; cookie writes need X-Tokkl-CSRF.
- Open [**Users, roles and workspace membership**](../api-and-data/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
### #calendar
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #clipboard
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #common
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../tooling-and-project/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #components
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](../web-ui-styling-and-layout/map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #e2e
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Running the Playwright e2e suite**](../tooling-and-project/practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../tooling-and-project/practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #entry-list
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #forms
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #keyboard
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](../web-ui-styling-and-layout/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #self-hosting
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](../web-ui-styling-and-layout/practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #timer
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.