# kenkeep Index: tooling-and-project / testing

↑ Parent: [tooling-and-project](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`e2e-suite/`](e2e-suite/index.md) for more information on how the Playwright e2e suite runs, isolates workers and accounts, and how to write specs; read before running, adding or debugging an e2e spec.

## Conventions (how we build)
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) to learn about: 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check. #testing #e2e #playwright #visual
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) to learn about: duration, timeOfDay, snap and pomodoroSession cases are a cross-client contract in JSON; add cases there, not in TS tests. #testing #common #parsing

## Components (what exists)
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint. #testing #typecheck #tooling #workflow
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) to learn about: bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it. #performance #bench #tooling #reports

## By topic

### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](../kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds each on its own leg, then a gate attaches both to v<version>.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet and the applet chain store; QML_FOREIGN types; version and README.
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](../map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](../../web-ui-behaviour/map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](../../web-ui-behaviour/map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](../../web-ui-behaviour/practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](../../web-ui-behaviour/practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay, snap and pomodoroSession cases are a cross-client contract in JSON; add cases there, not in TS tests.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write-path references with getProjectRef and getTaskRef**](../../api-and-data/reports-and-totals/practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](../repo-and-scripts/map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../../api-and-data/reports-and-totals/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**styles.css loads last and owns the colour tokens**](../../web-ui-styling-and-layout/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](../../web-ui-styling-and-layout/practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #visual
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](../repo-and-scripts/practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](../repo-and-scripts/practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.