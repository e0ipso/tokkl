---
okf_version: '0.1'
---
# kenkeep Index

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) to learn about: test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them. #testing #e2e #playwright #workflow
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) to learn about: New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color. #web #css #accessibility #contrast #projects
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen. #web #css #mobile #layout
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) to learn about: Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint. #web #css #theme #dark-mode #e2e
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #common
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) to learn about: Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1. #server #auth #security #rate-limit #csrf
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals. #server #models #performance #validation
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) to learn about: Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch. #web #react-query #timer #entry-list
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #time #parsing
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) to learn about: Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets. #web #a11y #keyboard #react #reports
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) to learn about: TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected. #web #css #timer #mobile
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) to learn about: navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand. #web #clipboard #self-hosting
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) to learn about: Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css. #web #css #fonts #motion #accessibility
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults. #server #preferences #validation
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) to learn about: styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals. #web #css #cascade #tokens #reports
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) to learn about: HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match. #web #calendar #css #e2e

## Components (what exists)
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css. #web #components #css #reuse
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) to learn about: Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree. #monorepo #workspaces #layout #tooling #common #api #web #types
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint. #testing #typecheck #tooling #workflow
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) to learn about: Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings. #server #reports #api #web
- Open [**App icons: npm run icons renders the PNGs from icon.svg**](map-app-icons-script.md) to learn about: scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright Chromium; shapes stay in the maskable safe zone, background full-bleed. #tooling #pwa #icons #playwright #web
- Open [**App shell: Brand.tsx, the SVG wordmark and the NAV list**](map-app-shell-brand-and-navigation.md) to learn about: One Brand component (icon plus paths-only Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog. #web #navigation #brand #mobile
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) to learn about: bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it. #performance #bench #tooling #reports
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) to learn about: PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too. #web #a11y #react #components #forms #e2e
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) to learn about: Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work. #server #web #config #rename

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #server
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #css
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #reports
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #tooling
- Open [**App icons: npm run icons renders the PNGs from icon.svg**](map-app-icons-script.md) — scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright Chromium; shapes stay in the maskable safe zone, background full-bleed.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #e2e
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #validation
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #api
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #mobile
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**App shell: Brand.tsx, the SVG wordmark and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon plus paths-only Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #playwright
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
- Open [**App icons: npm run icons renders the PNGs from icon.svg**](map-app-icons-script.md) — scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright Chromium; shapes stay in the maskable safe zone, background full-bleed.
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
### #time
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #a11y
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #accessibility
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #calendar
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #common
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #components
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #projects
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #react
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #testing
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #timer
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
### #workflow
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #auth
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1.
### #backup
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #brand
- Open [**App shell: Brand.tsx, the SVG wordmark and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon plus paths-only Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #cascade
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #clients
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #clipboard
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #config
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #contrast
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
### #csrf
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1.
### #dark-mode
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #docs
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #entry-list
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #fonts
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #forms
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #icons
- Open [**App icons: npm run icons renders the PNGs from icon.svg**](map-app-icons-script.md) — scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright Chromium; shapes stay in the maskable safe zone, background full-bleed.
### #import
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #keyboard
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #models
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #money
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #monorepo
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #motion
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #navigation
- Open [**App shell: Brand.tsx, the SVG wordmark and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon plus paths-only Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #pwa
- Open [**App icons: npm run icons renders the PNGs from icon.svg**](map-app-icons-script.md) — scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright Chromium; shapes stay in the maskable safe zone, background full-bleed.
### #rate-limit
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1.
### #react-query
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #rename
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #restore
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #reuse
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #security
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Tokkl-CSRF: 1.
### #self-hosting
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #tokens
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #types
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
