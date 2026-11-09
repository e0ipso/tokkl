# kenkeep Index: api-and-data / reports-and-totals

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**Validate write references with transaction-bound reference getters**](practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths. #server #models #performance #validation
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) to learn about: GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchOracle.ts pins the answer. #server #tasks #toggl
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money

## Components (what exists)
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) to learn about: Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings. #server #reports #api #web
- Open [**Catalog revision and latest entry endpoints for caching clients**](map-catalog-revision-and-latest-entry-endpoints.md) to learn about: GET /api/app/workspaces/{wid}/catalog counts project-list writes in workspaces.catalog_revision; GET /api/app/time_entries/latest answers the newest entry by start. #server #projects #clients #desktop

## By topic

### #server
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Signed-in operations bind the authenticated user at construction**](../users-and-admin/practice-signed-in-operations-bind-the-authenticated-user.md) — entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor take the Authentication once; routes never pass the user's id or the admin actor again.
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
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
### #reports
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**styles.css orders the cascade and owns the colour tokens**](../../web-ui-styling-and-layout/theme-and-tokens/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css imports every sheet in cascade order, page sheets first; page CSS uses its tokens and no colour literals.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](../../web-ui-styling-and-layout/shell-and-layout/practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #api
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](../toggl-compat-and-import/practice-creates-take-an-idempotency-key.md) — v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](../../tooling-and-project/kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../../tooling-and-project/kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**Desktop app identifiers use the canpicasoft.com domain**](../../tooling-and-project/practice-desktop-app-identifiers-use-the-canpicasoft-com-domain.md) — KDE, macOS and GNOME identifiers use com.canpicasoft.tokkl / tokkl@canpicasoft.com, never com.github.e0ipso or e0ipso.github.com.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Browser storage restart and migration isolation**](../../tooling-and-project/testing/e2e-suite/map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) — Browser restart tests preserve real accounts/preferences; explicit storage fixtures own migration and legacy refusal checks.
### #models
- Open [**Validate write references with transaction-bound reference getters**](practice-write-paths-validate-refs-not-totals.md) — Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths.
### #money
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #tasks
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) — GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchOracle.ts pins the answer.
### #toggl
- Open [**The workspace task search keeps JavaScript's case folding and name order**](practice-workspace-task-search-keeps-javascript-order.md) — GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL, and sorts names with localeCompare in memory; test/fixtures/taskSearchOracle.ts pins the answer.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.