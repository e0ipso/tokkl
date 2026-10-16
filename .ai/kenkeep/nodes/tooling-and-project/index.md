# kenkeep Index: tooling-and-project

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) to learn about: test:e2e builds first and runs a parallel desktop project plus a one-worker instance project; each worker has its own user; auto fixtures wipe that user's data and fail tests on runtime errors unless a spec allows them. #testing #e2e #playwright #workflow
- Open [**KDE companion: connection errors, settings generations and the Configure page**](practice-kde-companion-connection-and-configure-page-rules.md) to learn about: Access kinds decide what a 401/403 means; old-generation replies drop; cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet. #kde #desktop #auth #configuration
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) to learn about: 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check. #testing #e2e #playwright #visual
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) to learn about: commitlint rejects Co-authored-by and AI tool trailers and subjects over 72 chars; worktrees without npm ci skip the hook. #tooling #workflow #git
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) to learn about: TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT. #kde #desktop

## Components (what exists)
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint. #testing #typecheck #tooling #workflow
- Open [**KDE Plasma companion in desktop/kde**](map-kde-plasma-companion-desktop-kde.md) to learn about: Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl; tokklcore library; panel item and menu; versioned from root package.json; 12 ctest tests; DEB and RPM packaging. #tooling #kde #desktop #testing
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) to learn about: Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree. #monorepo #workspaces #layout #tooling #common #api #web #types
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) to learn about: scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied. #tooling #pwa #icons #imagemagick #maskable #web
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) to learn about: The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release. #tooling #kde #ci #release
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) to learn about: tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping. #tooling #kde #packaging #release
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) to learn about: bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it. #performance #bench #tooling #reports
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) to learn about: Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work. #server #web #config #rename

## By topic

### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE Plasma companion in desktop/kde**](map-kde-plasma-companion-desktop-kde.md) — Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl; tokklcore library; panel item and menu; versioned from root package.json; 12 ctest tests; DEB and RPM packaging.
### #kde
- Open [**KDE Plasma companion in desktop/kde**](map-kde-plasma-companion-desktop-kde.md) — Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl; tokklcore library; panel item and menu; versioned from root package.json; 12 ctest tests; DEB and RPM packaging.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
### #testing
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first and runs a parallel desktop project plus a one-worker instance project; each worker has its own user; auto fixtures wipe that user's data and fail tests on runtime errors unless a spec allows them.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #desktop
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**KDE Plasma companion in desktop/kde**](map-kde-plasma-companion-desktop-kde.md) — Standalone CMake project for the Plasma widget com.github.e0ipso.tokkl; tokklcore library; panel item and menu; versioned from root package.json; 12 ctest tests; DEB and RPM packaging.
- Open [**KDE companion: connection errors, settings generations and the Configure page**](practice-kde-companion-connection-and-configure-page-rules.md) — Access kinds decide what a 401/403 means; old-generation replies drop; cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet.
### #playwright
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first and runs a parallel desktop project plus a one-worker instance project; each worker has its own user; auto fixtures wipe that user's data and fail tests on runtime errors unless a spec allows them.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #workflow
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI tool trailers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first and runs a parallel desktop project plus a one-worker instance project; each worker has its own user; auto fixtures wipe that user's data and fail tests on runtime errors unless a spec allows them.
### #e2e
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — test:e2e builds first and runs a parallel desktop project plus a one-worker instance project; each worker has its own user; auto fixtures wipe that user's data and fail tests on runtime errors unless a spec allows them.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #release
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
### #api
- Open [**Parse incoming timestamps with parseInstant**](../api-and-data/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../api-and-data/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
### #auth
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](../api-and-data/practice-password-checks-and-csrf-rules.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; writes, login, setup and invite accept need X-Tokkl-CSRF.
- Open [**Users, roles and workspace membership**](../api-and-data/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
- Open [**Admin API and disabled accounts**](../api-and-data/map-admin-api-and-disabled-accounts.md) — /api/app/admin users, delete, invites and instance settings; public invite routes; last-active-admin rule; where disabled accounts are refused.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #ci
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
### #common
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**UI time math uses account-local wall-clock helpers**](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #config
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #configuration
- Open [**KDE companion: connection errors, settings generations and the Configure page**](practice-kde-companion-connection-and-configure-page-rules.md) — Access kinds decide what a 401/403 means; old-generation replies drop; cfg_instanceUrl holds only persistedUrl(); secrets only in KWallet.
### #docs
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #git
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI tool trailers and subjects over 72 chars; worktrees without npm ci skip the hook.
### #icons
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #imagemagick
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #layout
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #maskable
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #monorepo
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](../api-and-data/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write-path references with getProjectRef and getTaskRef**](../api-and-data/practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #pwa
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #rename
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](../web-ui-behaviour/practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](../web-ui-styling-and-layout/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #server
- Open [**Toggl CSV import: choose team-export users by opaque key**](../api-and-data/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../api-and-data/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../api-and-data/practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — Both run per workspace; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #types
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #visual
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Users, roles and workspace membership**](../api-and-data/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.