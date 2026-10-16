# kenkeep Index: tooling-and-project / repo-and-scripts

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) to learn about: commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook. #tooling #workflow #git
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) to learn about: TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. #tooling #docs #comments #commits #sift #strikethroo

## Components (what exists)
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) to learn about: Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree. #monorepo #workspaces #layout #tooling #common #api #web #types
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) to learn about: scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied. #tooling #pwa #icons #imagemagick #maskable #web
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) to learn about: Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work. #server #web #config #rename

## By topic

### #tooling
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #docs
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact.
### #api
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Web app report endpoints under /api/app/report**](../../api-and-data/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
### #comments
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact.
### #commits
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact.
### #common
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #config
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #git
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
### #icons
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #imagemagick
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #layout
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #maskable
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #monorepo
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../testing/practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #pwa
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #rename
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #server
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../../api-and-data/practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #sift
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact.
### #strikethroo
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact.
### #types
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #workflow
- Open [**What npm test and npm run typecheck cover**](../testing/map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Users, roles and workspace membership**](../../api-and-data/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.