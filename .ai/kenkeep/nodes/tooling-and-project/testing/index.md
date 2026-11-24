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
- Open [**Production image smoke test: scripts/production-image-smoke.ts**](map-production-image-smoke-test-scripts-production-image-smoke-ts.md) to learn about: npm run test:container smoke-tests a built production image per backend and asserts the exact count of applied storage migrations. #container #testing #migrations #ci

## By topic

### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](../kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #bench
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #ci
- Open [**KDE real-server test**](../kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Tests for release-only CI steps**](../kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](../../web-ui-behaviour/pomodoro/map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../../web-ui-behaviour/time-and-timers/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #container
- Open [**Production image smoke test: scripts/production-image-smoke.ts**](map-production-image-smoke-test-scripts-production-image-smoke-ts.md) — npm run test:container smoke-tests a built production image per backend and asserts the exact count of applied storage migrations.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../../api-and-data/users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Browser storage restart and migration isolation**](e2e-suite/map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) — Browser restart tests preserve real accounts/preferences; explicit storage fixtures own migration and legacy refusal checks.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](../../web-ui-behaviour/time-and-timers/practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](../../web-ui-behaviour/time-and-timers/practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay, snap and pomodoroSession cases are a cross-client contract in JSON; add cases there, not in TS tests.
### #performance
- Open [**Project and task totals rely on the live-entry partial indexes**](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Validate write references with transaction-bound reference getters**](../../api-and-data/reports-and-totals/practice-write-paths-validate-refs-not-totals.md) — Entry and catalog writes use scoped getRef contracts; full projections compute totals and stay off validation paths.
- Open [**History-scale bench: npm run bench:history**](map-history-scale-bench.md) — bench/history.ts times reports, lists, writes and the timer on throwaway year (3k) and decade (30k) fixtures; wrong answers fail it.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](../repo-and-scripts/map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #reports
- Open [**Report route admission to the ReportRunner report lane**](../../api-and-data/reports-and-totals/app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](../../api-and-data/reports-and-totals/app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](../../api-and-data/reports-and-totals/app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
### #visual
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](../repo-and-scripts/practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](../repo-and-scripts/practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.