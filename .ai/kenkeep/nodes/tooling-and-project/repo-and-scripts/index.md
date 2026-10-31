# kenkeep Index: tooling-and-project / repo-and-scripts

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`app-icons-script/`](app-icons-script/index.md) for more information on the npm run icons script that derives every served brand image from docs/brand, its web, wordmark and desktop outputs and the tests that check them; read before changing a brand pack output or scripts/icons.ts.

## Conventions (how we build)
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) to learn about: commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook. #tooling #workflow #git
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) to learn about: icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md. #brand #assets #docs
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) to learn about: TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it. #tooling #docs #comments #commits #sift #strikethroo
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) to learn about: Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes. #release #git #semantic-release #workflow
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) to learn about: The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo. #docs #readme #deployment #truenas
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) to learn about: Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs. #git #github #pull-requests #workflow
- Open [**README, docs and comments describe the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) to learn about: README.md, docs and code comments document how Tokkl works now. No rename story, audit dates, before-and-after history or tuning notes. #docs #readme #comments

## Components (what exists)
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) to learn about: Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree. #monorepo #workspaces #layout #tooling #common #api #web #types
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) to learn about: scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops. #tooling #docs #screenshots #playwright
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) to learn about: Legacy non-database environment settings, cookies, CSRF, theme and export formats are accepted; storage selection is explicit. #server #web #config #rename

## By topic

### #docs
- Open [**README, docs and comments describe the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) — README.md, docs and code comments document how Tokkl works now. No rename story, audit dates, before-and-after history or tuning notes.
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #tooling
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE and core CI jobs**](../kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md) — The kde job builds, tests and checks the DEB and RPM in pinned containers; core checks Qt Core-only links; baseline floors; manual checks.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #git
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](../testing/map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
### #comments
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
- Open [**README, docs and comments describe the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) — README.md, docs and code comments document how Tokkl works now. No rename story, audit dates, before-and-after history or tuning notes.
### #readme
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
- Open [**README, docs and comments describe the current project, never its history**](practice-readme-describes-the-current-project-never-its-history.md) — README.md, docs and code comments document how Tokkl works now. No rename story, audit dates, before-and-after history or tuning notes.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #api
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #assets
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #brand
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](../../web-ui-styling-and-layout/shell-and-layout/map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #commits
- Open [**Keep Sift ticket IDs and Strikethroo plans out of code and public docs**](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md) — TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code, comments, tests, docs and commit subjects state the fact. CI enforces it.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](../../web-ui-behaviour/pomodoro/map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/time-and-timers/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #config
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Legacy non-database environment settings, cookies, CSRF, theme and export formats are accepted; storage selection is explicit.
### #deployment
- Open [**Container image ghcr.io/e0ipso/tokkl**](../map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
- Open [**Keep TrueNAS install steps out of the repo README**](practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
### #github
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
### #layout
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../../web-ui-styling-and-layout/shell-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](../../web-ui-styling-and-layout/shell-and-layout/practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #monorepo
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../testing/practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #pull-requests
- Open [**Merge a PR stack bottom-up without retargeting its PRs**](practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs.md) — Merge stacked PRs bottom-up, starting with the one based on main. Don't repoint upper PR bases or close and reopen PRs.
### #release
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](../kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](../kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
### #rename
- Open [**Old Timetrack names still accepted after the Tokkl rename**](map-tokkl-rename-legacy-name-fallbacks.md) — Legacy non-database environment settings, cookies, CSRF, theme and export formats are accepted; storage selection is explicit.
### #screenshots
- Open [**README screenshots: npm run screenshots**](map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #semantic-release
- Open [**Do not mark commits as breaking changes**](practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../../api-and-data/users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Entry resolution at DST imports and reports**](../../api-and-data/time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
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
- Open [**Users, roles and workspace membership**](../../api-and-data/users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.