# kenkeep Index: api-and-data / reports-and-totals

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`app-report-pipeline/`](app-report-pipeline/index.md) for more information on web app report routes, report and download lanes, report job reads and the reports page client; read when you change a report endpoint, export, the ReportRunner or the reports page.

## Conventions (how we build)
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**Validate write references with transaction-bound reference getters**](practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths. #server #models #performance #validation
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) to learn about: GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchGolden.ts pins the answer. #server #tasks #toggl
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money

## Components (what exists)
- Open [**Catalog revision and latest entry endpoints for caching clients**](map-catalog-revision-and-latest-entry-endpoints.md) to learn about: GET /api/app/workspaces/{wid}/catalog counts project-list writes in workspaces.catalog_revision; GET /api/app/time_entries/latest answers the newest entry by start. #server #projects #clients #desktop

## By topic

### #server
- Open [**Recheck credentials inside the guarded account transaction**](../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #clients
- Open [**Catalog revision and latest entry endpoints for caching clients**](map-catalog-revision-and-latest-entry-endpoints.md) — GET /api/app/workspaces/{wid}/catalog counts project-list writes in workspaces.catalog_revision; GET /api/app/time_entries/latest answers the newest entry by start.
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write references with transaction-bound reference getters**](practice-write-paths-validate-refs-not-totals.md) — Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths.
- Open [**History-scale bench: npm run bench:history**](../../tooling-and-project/testing/map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #projects
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
- Open [**Catalog revision and latest entry endpoints for caching clients**](map-catalog-revision-and-latest-entry-endpoints.md) — GET /api/app/workspaces/{wid}/catalog counts project-list writes in workspaces.catalog_revision; GET /api/app/time_entries/latest answers the newest entry by start.
- Open [**Contrast tables in styles.css; project colours never paint text**](../../web-ui-styling-and-layout/theme-and-tokens/practice-contrast-tables-and-project-colours.md) — Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](../toggl-compat-and-import/practice-creates-take-an-idempotency-key.md) — v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](../../tooling-and-project/kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../../tooling-and-project/kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../../tooling-and-project/kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Browser storage restart and migration isolation**](../../tooling-and-project/testing/e2e-suite/map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) — Browser restart tests preserve real accounts/preferences; explicit storage fixtures own migration and legacy refusal checks.
### #models
- Open [**Validate write references with transaction-bound reference getters**](practice-write-paths-validate-refs-not-totals.md) — Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths.
### #money
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #reports
- Open [**Report route admission to the ReportRunner report lane**](app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #tasks
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) — GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchGolden.ts pins the answer.
### #toggl
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) — GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchGolden.ts pins the answer.