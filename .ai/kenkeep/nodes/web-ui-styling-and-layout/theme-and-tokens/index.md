# kenkeep Index: web-ui-styling-and-layout / theme-and-tokens

↑ Parent: [web-ui-styling-and-layout](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) to learn about: Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color. #web #css #accessibility #contrast #projects #tokens
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) to learn about: Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint. #web #css #theme #dark-mode #e2e
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) to learn about: Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge. #web #css #navigation #contrast #tokens #calendar
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) to learn about: Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css. #web #css #fonts #motion #accessibility
- Open [**styles.css orders the cascade and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) to learn about: styles.css imports every sheet in cascade order, page sheets first; page CSS uses its tokens and no colour literals. #web #css #cascade #tokens #reports

## Components (what exists)
_None yet._

## By topic

### #css
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../shell-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #tokens
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
- Open [**styles.css orders the cascade and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css imports every sheet in cascade order, page sheets first; page CSS uses its tokens and no colour literals.
### #accessibility
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #contrast
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #calendar
- Open [**Week calendar hour height lives in three places**](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #cascade
- Open [**styles.css orders the cascade and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css imports every sheet in cascade order, page sheets first; page CSS uses its tokens and no colour literals.
### #dark-mode
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #fonts
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #motion
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #navigation
- Open [**NAV list, phone More sheet and nav running dots**](../shell-and-layout/app-shell/map-nav-list-phone-more-sheet-and-nav-running-dots.md) — NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots.
- Open [**Phone e2e navigation helpers tapNav and openMore**](../shell-and-layout/app-shell/map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) — Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin.
- Open [**Lazy page chunks and failed-load recovery**](../shell-and-layout/app-shell/map-lazy-page-chunks-and-failed-load-recovery.md) — Shell.tsx imports only TimerPage; other pages load from lazyPages.tsx with prefetch, one retry and a guarded reload on failure.
### #projects
- Open [**Deleting a client detaches its projects and never merges them**](../../api-and-data/reports-and-totals/practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
- Open [**Catalog revision and latest entry endpoints for caching clients**](../../api-and-data/reports-and-totals/map-catalog-revision-and-latest-entry-endpoints.md) — GET /api/app/workspaces/{wid}/catalog counts project-list writes in workspaces.catalog_revision; GET /api/app/time_entries/latest answers the newest entry by start.
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — Colour pairs get a computed row in the styles.css table; text uses --primary-text, not --primary; a project hex only sets --project-color.
### #reports
- Open [**Report route admission to the ReportRunner report lane**](../../api-and-data/reports-and-totals/app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](../../api-and-data/reports-and-totals/app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](../../api-and-data/reports-and-totals/app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](../../web-ui-behaviour/interaction-and-state/practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.