# kenkeep Index: tooling-and-project / testing

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`e2e-suite/`](e2e-suite/index.md) for more information on how the Playwright e2e suite runs, isolates workers and accounts, and how to write specs; read before running, adding or debugging an e2e spec.

## Conventions (how we build)
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) to learn about: 24 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check. #testing #e2e #playwright #visual
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) to learn about: duration, timeOfDay and snap cases are a cross-client contract in JSON; add parser cases there, not in TS tests. #testing #common #parsing

## Components (what exists)
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint. #testing #typecheck #tooling #workflow
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) to learn about: bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it. #performance #bench #tooling #reports

## By topic

### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](../map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #common
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay and snap cases are a cross-client contract in JSON; add parser cases there, not in TS tests.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](../../web-ui-behaviour/practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](../../web-ui-behaviour/practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay and snap cases are a cross-client contract in JSON; add parser cases there, not in TS tests.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write-path references with getProjectRef and getTaskRef**](../../api-and-data/reports-and-totals/practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 24 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](../repo-and-scripts/map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../../api-and-data/reports-and-totals/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](../../web-ui-behaviour/practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**styles.css loads last and owns the colour tokens**](../../web-ui-styling-and-layout/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #visual
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 24 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](../repo-and-scripts/practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](../repo-and-scripts/practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.