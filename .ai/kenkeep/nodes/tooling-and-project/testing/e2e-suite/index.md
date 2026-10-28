# kenkeep Index: tooling-and-project / testing / e2e-suite

↑ Parent: [testing](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Playwright gotchas in the e2e specs**](practice-playwright-gotchas-in-the-e2e-specs.md) to learn about: 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day. #testing #playwright
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) to learn about: test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked. #testing #e2e #workflow
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) to learn about: Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure. #testing #e2e
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) to learn about: Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login. #testing #e2e

## Components (what exists)
- Open [**rewindDatabase: the migration-upgrade e2e scenarios in auth-browser.spec.ts**](map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) to learn about: rewindDatabase makes a current DB look pre-migration N; upgrade scenarios restart on it and assert the latest user_version. #testing #e2e #migrations

## By topic

### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](../../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../../../api-and-data/users-and-admin/map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
- Open [**rewindDatabase: the migration-upgrade e2e scenarios in auth-browser.spec.ts**](map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) — rewindDatabase makes a current DB look pre-migration N; upgrade scenarios restart on it and assert the latest user_version.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits; group entries on a past day.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../practice-visual-screenshot-baselines.md) — 32 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](../../repo-and-scripts/map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #workflow
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](../../repo-and-scripts/practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and subjects over 72 chars; worktrees without npm ci skip the hook.
- Open [**What npm test and npm run typecheck cover**](../map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Do not mark commits as breaking changes**](../../repo-and-scripts/practice-do-not-mark-commits-as-breaking-changes.md) — Commits and PR titles carry no \`!\` or \`BREAKING CHANGE:\` footer, so semantic-release never cuts a major release, even for behavior changes.