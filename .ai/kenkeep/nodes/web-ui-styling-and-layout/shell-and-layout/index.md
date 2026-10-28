# kenkeep Index: web-ui-styling-and-layout / shell-and-layout

↑ Parent: [web-ui-styling-and-layout](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell. #web #css #mobile #layout
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) to learn about: Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile. #web #css #reports #layout #mobile #e2e
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) to learn about: TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected. #web #css #timer #mobile

## Components (what exists)
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css. #web #components #css #reuse
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) to learn about: One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog. #web #navigation #brand #mobile #wordmark
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) to learn about: The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons. #pwa #manifest #icons #favicon #web #testing

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #css
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #mobile
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../../tooling-and-project/repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #brand
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](../../tooling-and-project/repo-and-scripts/practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #components
- Open [**Entry fields: EntryFields.tsx and useEntryFields.ts**](../../web-ui-behaviour/interaction-and-state/map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, suggestions, project/task and tag pickers and billable toggle; the parent decides what an edit writes.
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
### #navigation
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](../theme-and-tokens/practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #pwa
- Open [**npm run icons inputs and web icons**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../../api-and-data/reports-and-totals/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**styles.css loads last and owns the colour tokens**](../theme-and-tokens/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
### #reuse
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #wordmark
- Open [**Wordmark crop and its four outputs**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-wordmark-crop-and-its-four-outputs.md) — WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**icons.test.ts checks and rerunning the script**](../../tooling-and-project/repo-and-scripts/app-icons-script/map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.