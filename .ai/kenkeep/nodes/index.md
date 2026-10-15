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
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen. #web #css #mobile #layout
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) to learn about: Colour tokens are light-dark() on :root; \[data-theme\] only sets color-scheme. The build lowers light-dark(), so nested schemes don't flip. #web #css #theme #dark-mode #e2e
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #shared
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals. #server #models #performance #validation
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #shared #time #parsing
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) to learn about: navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand. #web #clipboard #self-hosting
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) to learn about: Anybody ships from web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css. #web #css #fonts #motion #accessibility
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) to learn about: Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1. #server #auth #security #rate-limit #csrf
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults. #server #preferences #validation
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) to learn about: Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch. #web #react-query #timer #entry-list

## Components (what exists)
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) to learn about: Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings. #server #reports #api #web
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: npm test runs only server/test and shared tests; web/src logic goes through shared or e2e; no lint script; typecheck runs four tsconfigs. #testing #typecheck #tooling #workflow
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) to learn about: bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it. #performance #bench #tooling #reports
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Shared list controls live in web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx and the .search-box, .inline-input, .card classes. #web #components #css #reuse

## By topic

### #web
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
- Open [**Shared list controls live in web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx and the .search-box, .inline-input, .card classes.
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
### #server
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #css
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
### #validation
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #reports
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #time
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #tooling
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic goes through shared or e2e; no lint script; typecheck runs four tsconfigs.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #accessibility
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #api
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
### #e2e
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Colour tokens are light-dark() on :root; \[data-theme\] only sets color-scheme. The build lowers light-dark(), so nested schemes don't flip.
### #playwright
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #projects
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #shared
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #testing
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic goes through shared or e2e; no lint script; typecheck runs four tsconfigs.
### #workflow
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic goes through shared or e2e; no lint script; typecheck runs four tsconfigs.
### #auth
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #backup
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #calendar
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #clients
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #clipboard
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #components
- Open [**Shared list controls live in web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx and the .search-box, .inline-input, .card classes.
### #contrast
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
### #csrf
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #dark-mode
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Colour tokens are light-dark() on :root; \[data-theme\] only sets color-scheme. The build lowers light-dark(), so nested schemes don't flip.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #docs
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #entry-list
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #fonts
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #import
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #mobile
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, and grid or flex items without min-width: 0 stretch past a phone screen.
### #models
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #money
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #motion
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #rate-limit
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #react-query
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #restore
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #reuse
- Open [**Shared list controls live in web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx and the .search-box, .inline-input, .card classes.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #security
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #self-hosting
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Colour tokens are light-dark() on :root; \[data-theme\] only sets color-scheme. The build lowers light-dark(), so nested schemes don't flip.
### #timer
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic goes through shared or e2e; no lint script; typecheck runs four tsconfigs.
