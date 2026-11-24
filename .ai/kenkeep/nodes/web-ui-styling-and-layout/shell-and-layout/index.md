# kenkeep Index: web-ui-styling-and-layout / shell-and-layout

↑ Parent: [web-ui-styling-and-layout](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`app-shell/`](app-shell/index.md) for more information on the web app shell: the Brand wordmark, the NAV list and phone More sheet, and lazy page loading; read when changing the brand, adding a page or editing navigation.

## Conventions (how we build)
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell. #web #css #mobile #layout
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) to learn about: Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile. #web #css #reports #layout #mobile #e2e
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) to learn about: TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected. #web #css #timer #mobile

## Components (what exists)
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css. #web #components #css #reuse
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) to learn about: The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons. #pwa #manifest #icons #favicon #web #testing

## By topic

### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #css
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #mobile
- Open [**NAV list, phone More sheet and nav running dots**](app-shell/map-nav-list-phone-more-sheet-and-nav-running-dots.md) — NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots.
- Open [**Phone e2e navigation helpers tapNav and openMore**](app-shell/map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) — Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../../tooling-and-project/repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #components
- Open [**Entry fields: EntryFields.tsx, DescriptionCombobox.tsx and useEntryFields.ts**](../../web-ui-behaviour/interaction-and-state/map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, project/task and tag pickers and billable toggle; the shared DescriptionCombobox gives the timer bar, editor and rows the same suggestions; the owner decides what an edit or pick writes.
- Open [**Loading, error, empty and field-error states use the shared components**](../../web-ui-behaviour/interaction-and-state/map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #favicon
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #icons
- Open [**Desktop colour and monochrome icons**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-desktop-colour-and-monochrome-icons.md) — LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks.
- Open [**npm run icons inputs and web icons**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**icons.test.ts checks and rerunning the script**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
### #manifest
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #pwa
- Open [**npm run icons inputs and web icons**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #reports
- Open [**Report route admission to the ReportRunner report lane**](../../api-and-data/reports-and-totals/app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](../../api-and-data/reports-and-totals/app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](../../api-and-data/reports-and-totals/app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #reuse
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.