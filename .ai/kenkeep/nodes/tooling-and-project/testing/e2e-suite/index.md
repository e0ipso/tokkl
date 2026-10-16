# kenkeep Index: tooling-and-project / testing / e2e-suite

↑ Parent: [testing](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Playwright gotchas in the e2e specs**](practice-playwright-gotchas-in-the-e2e-specs.md) to learn about: 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits. #testing #playwright
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) to learn about: test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked. #testing #e2e #workflow
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) to learn about: Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure. #testing #e2e
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) to learn about: Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login. #testing #e2e

## Components (what exists)
_None yet._

## By topic

### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #playwright
- Open [**Playwright gotchas in the e2e specs**](practice-playwright-gotchas-in-the-e2e-specs.md) — 200 is not proof a file exists; clock.install not pauseAt; phone helpers, expectFits, cellTexts polling, networkidle limits.
- Open [**Visual baselines: e2e/visual.spec.ts and how to refresh them**](../practice-visual-screenshot-baselines.md) — 20 toHaveScreenshot baselines tied to the default headless shell; refresh with --update-snapshots=all; tiny elements need their own check.
- Open [**README screenshots: npm run screenshots**](../../repo-and-scripts/map-readme-screenshots-script.md) — scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen clock; SQLite unixepoch('now') ignores it, so the timer stops.
### #workflow
- Open [**What npm test and npm run typecheck cover**](../map-test-and-static-analysis-layout.md) — npm test runs the workspaces then the e2e node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
- Open [**Commit messages: Conventional Commits, no co-author or AI trailers**](../../repo-and-scripts/practice-commit-messages-pass-commitlint-no-ai-generated.md) — commitlint rejects Co-authored-by and AI tool trailers and subjects over 72 chars; worktrees without npm ci skip the hook.