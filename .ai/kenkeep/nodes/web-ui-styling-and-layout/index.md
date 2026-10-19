# kenkeep Index: web-ui-styling-and-layout

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) to learn about: New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color. #web #css #accessibility #contrast #projects
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) to learn about: Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint. #web #css #theme #dark-mode #e2e
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell. #web #css #mobile #layout
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) to learn about: HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match. #web #calendar #css #e2e
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) to learn about: assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller. #web #calendar #css
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) to learn about: TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected. #web #css #timer #mobile
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) to learn about: Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css. #web #css #fonts #motion #accessibility
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) to learn about: styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals. #web #css #cascade #tokens #reports

## Components (what exists)
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css. #web #components #css #reuse
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) to learn about: One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog. #web #navigation #brand #mobile #wordmark
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) to learn about: The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons. #pwa #manifest #icons #favicon #web #testing
- Open [**Web calendar day view and touch gestures in WeekCalendar**](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md) to learn about: Below 760px WeekCalendar shows one day under a week strip; touch drags start after a 500 ms long press, mouse drags at once. #web #calendar #touch #mobile #e2e

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #css
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #mobile
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
### #calendar
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Web calendar day view and touch gestures in WeekCalendar**](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md) — Below 760px WeekCalendar shows one day under a week strip; touch drags start after a 500 ms long press, mouse drags at once.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #accessibility
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #brand
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](../tooling-and-project/repo-and-scripts/practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #cascade
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #components
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
- Open [**Loading, error, empty and field-error states use the shared components**](../web-ui-behaviour/map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #contrast
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
### #dark-mode
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #favicon
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #fonts
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #icons
- Open [**Brand images: npm run icons derives every served file from docs/brand**](../tooling-and-project/repo-and-scripts/map-app-icons-script.md) — icons.ts copies or quantises the web icons, renders the KDE, GNOME and macOS icons from the master, crops the wordmark; no test reruns it.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #layout
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../tooling-and-project/repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #manifest
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #motion
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #navigation
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
### #projects
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Deleting a client detaches its projects and never merges them**](../api-and-data/reports-and-totals/practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #pwa
- Open [**Brand images: npm run icons derives every served file from docs/brand**](../tooling-and-project/repo-and-scripts/map-app-icons-script.md) — icons.ts copies or quantises the web icons, renders the KDE, GNOME and macOS icons from the master, crops the wordmark; no test reruns it.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/reports-and-totals/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](../web-ui-behaviour/practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #reuse
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](../web-ui-behaviour/practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #timer
- Open [**Web Pomodoro: pomodoroCycle.ts, usePomodoro and the app-wide PomodoroProvider**](../web-ui-behaviour/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — The Pomodoro runs on every signed-in page; a per-account cycle that follows the running entry, freezes at a pause and rings a local bell.
- Open [**Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules**](../web-ui-behaviour/practice-web-timer-bar-pause-chain-rules.md) — Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab, localStorage per account; Stop or a foreign entry ends it.
- Open [**Web UI state must survive background refetches**](../web-ui-behaviour/practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #tokens
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #touch
- Open [**Web calendar day view and touch gestures in WeekCalendar**](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md) — Below 760px WeekCalendar shows one day under a week strip; touch drags start after a 500 ms long press, mouse drags at once.
### #wordmark
- Open [**Brand images: npm run icons derives every served file from docs/brand**](../tooling-and-project/repo-and-scripts/map-app-icons-script.md) — icons.ts copies or quantises the web icons, renders the KDE, GNOME and macOS icons from the master, crops the wordmark; no test reruns it.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.