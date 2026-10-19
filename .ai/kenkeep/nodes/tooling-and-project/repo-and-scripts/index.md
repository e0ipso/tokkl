# kenkeep Index: tooling-and-project / repo-and-scripts

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) to learn about: commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook. #tooling #workflow #git
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) to learn about: TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it. #tooling #docs #comments #commits #sift #strikethroo
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) to learn about: Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes. #release #git #semantic-release #workflow
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) to learn about: icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md. #brand #assets #docs
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) to learn about: The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo. #docs #readme #deployment #truenas
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) to learn about: Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs. #git #github #pull-requests #workflow
- Open [**README describes the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) to learn about: README.md documents how Tokkl works now. No rename story, upgrade-from-old-name sections, audit dates or how-we-got-here notes. #docs #readme

## Components (what exists)
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) to learn about: Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree. #monorepo #workspaces #layout #tooling #common #api #web #types
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) to learn about: scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied. #tooling #pwa #icons #imagemagick #maskable #web
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) to learn about: Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work. #server #web #config #rename

## By topic

### #docs
- Open [**README describes the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) — README.md documents how Tokkl works now. No rename story, upgrade-from-old-name sections, audit dates or how-we-got-here notes.
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #git
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../../web-ui-styling-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](../testing/map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
### #readme
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
- Open [**README describes the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) — README.md documents how Tokkl works now. No rename story, upgrade-from-old-name sections, audit dates or how-we-got-here notes.
### #api
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #assets
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #brand
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](../../web-ui-styling-and-layout/map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
### #comments
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #commits
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #common
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](../testing/practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay and snap cases are a cross-client contract in JSON; add parser cases there, not in TS tests.
### #config
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #deployment
- Open [**Container image ghcr.io/e0ipso/tokkl**](../map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
### #github
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
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
- Open [**Playwright gotchas in the e2e specs**](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../testing/practice-visual-screenshot-baselines.md) — 24 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #pull-requests
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
### #pwa
- Open [**Brand images: npm run icons derives every served file from docs/brand**](map-app-icons-script.md) — scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7 into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
### #release
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
### #rename
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #semantic-release
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../../api-and-data/users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #sift
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #strikethroo
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #truenas
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
### #types
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Users, roles and workspace membership**](../../api-and-data/users-and-admin/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.