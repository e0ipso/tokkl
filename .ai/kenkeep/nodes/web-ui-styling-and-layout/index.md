# kenkeep Index: web-ui-styling-and-layout

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) to learn about: New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color. #web #css #accessibility #contrast #projects
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) to learn about: Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell. #web #css #mobile #layout
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) to learn about: Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint. #web #css #theme #dark-mode #e2e
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) to learn about: TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected. #web #css #timer #mobile
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) to learn about: Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css. #web #css #fonts #motion #accessibility
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) to learn about: styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals. #web #css #cascade #tokens #reports
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) to learn about: HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match. #web #calendar #css #e2e

## Components (what exists)
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) to learn about: Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css. #web #components #css #reuse
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) to learn about: One Brand component (icon image plus PNG Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog. #web #navigation #brand #mobile

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #css
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #mobile
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon image plus PNG Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #accessibility
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #e2e
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Running the Playwright e2e suite**](../tooling-and-project/practice-e2e-test-workflow.md) — test:e2e builds first; each run gets its own data dir; auto fixtures wipe data and fail tests on runtime errors unless a spec allows them.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../tooling-and-project/practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #brand
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon image plus PNG Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #calendar
- Open [**UI time math uses account-local wall-clock helpers**](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #cascade
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #components
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
- Open [**Loading, error, empty and field-error states use the shared components**](../web-ui-behaviour/map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #contrast
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
### #dark-mode
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #fonts
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../tooling-and-project/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #motion
- Open [**Display font is the bundled Anybody; one reduced-motion block ends styles.css**](practice-display-font-and-reduced-motion.md) — Anybody ships from packages/web/public/fonts with declared axis ranges and a crossorigin preload. One reduced-motion block ends styles.css.
### #navigation
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](map-app-shell-brand-and-navigation.md) — One Brand component (icon image plus PNG Tokkl wordmark); one NAV list whose inMore pages move into the phone More dialog.
### #projects
- Open [**Contrast tables in styles.css; project colours never paint text**](practice-contrast-tables-and-project-colours.md) — New colour pairs get a computed row in the styles.css contrast table. No opacity on text. A project hex only sets --project-color.
- Open [**Deleting a client detaches its projects and never merges them**](../api-and-data/practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #reports
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](../web-ui-behaviour/practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #reuse
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
### #timer
- Open [**Web UI state must survive background refetches**](../web-ui-behaviour/practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
### #tokens
- Open [**styles.css loads last and owns the colour tokens**](practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.