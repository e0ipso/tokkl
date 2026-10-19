---
type: practice
title: 'Running the e2e suite: build, Chromium, ports and the data directory'
description: >-
  test:e2e builds first; desktop runs in parallel and instance on one worker;
  E2E_PORT per run; a preset data dir is locked.
tags:
  - testing
  - e2e
  - workflow
kk_schema_version: 3
kk_id: practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
kk_derived_from: []
kk_relates_to:
  - practice-visual-screenshot-baselines
kk_depends_on: []
kk_confidence: high
---
- `npm run test:e2e` runs `npm run build` and then `playwright test`, so specs exercise the current UI. `npm run test:e2e:install` installs the Chromium headless shell explicitly; nothing installs it implicitly.
- `e2e/global-setup.ts` runs the Chromium check from `e2e/chromium-check.ts` (`scripts/screenshots.config.ts` uses only that check), then creates the setup admin of each server once before any worker starts. The check fails fast when the expected browser is missing or `CHROMIUM_PATH` points at nothing. Set `CHROMIUM_PATH` to use another Chromium or chrome-headless-shell binary. Leave it unset for `e2e/visual.spec.ts`: its baselines are tied to the default headless shell that Playwright 1.64.1 installs (revision 1248), and the older 1223 build in the cache renders them differently.
- `E2E_PORT` (default 8095) lets concurrent runs coexist; give each concurrent run its own port (the instance server below also takes `E2E_PORT + 1`, or `E2E_INSTANCE_PORT`), because `webServer` sets `reuseExistingServer: false` and will not share a server already on the port. `playwright.config.ts` picks a fresh `TOKKL_E2E_DATA_DIR` under the OS temp directory per run and deletes it when the run exits, pass or fail; a preset `TOKKL_E2E_DATA_DIR` is used as is, and the instance server uses `<dir>-instance`.
- `playwright.config.ts` has two projects on two servers. `desktop` is `fullyParallel` with `workers: '50%'` (pass `--workers` to change it). `instance` runs one worker on its own server and holds the specs in the `INSTANCE_SPECS` regex: `admin-page`, `history-calendar-resolution`, `timer-resolution`, `visual`, `worker-accounts` and `auth-access`/`browser`/`invite`/`reset`/`sessions`/`token`. They list every account or invite, change instance settings, compare admin-page screenshots, or start disposable servers on fixed ports. A new spec that reads or changes instance-wide state belongs there: add it to `INSTANCE_SPECS`, or a parallel worker will see or delete other workers' accounts. The instance project keeps the visual baseline names from when there was one project (`-desktop` in `snapshotPathTemplate`).
- A preset `TOKKL_E2E_DATA_DIR` serves one run at a time, because global setup deletes every worker account it finds there. `playwright.config.ts` claims it through `claimDataDir` in `e2e/data-dir-lock.ts` when the config loads, not in `globalSetup`: Playwright 1.64.1 starts `webServer` before `globalSetup`, so a check there would run after a second run's servers were already on the directory. Workers load the config again and skip the claim through `TOKKL_E2E_DATA_DIR_CLAIMED`. Default runs (fresh temporary directory) take no lock. The lock is `<dir>.lock` holding `{pid, host, id}` with a random id, written to a draft file and linked into place so a claim is atomic, and removed on exit. It is stale when its pid is gone on the same host; a lock from another host is never stale, because its pid cannot be checked. Stale lock and guard files are deleted only by the holder of the guard `<dir>.lock.recover-<first 16 hex digits of the sha256 of the content>`, and only while the content is unchanged; do not replace that with rename-aside. Old `{pid, host}` locks are still recognised. If a lock is wrong and recovery fails, delete `<dir>.lock` and every `<dir>.lock.recover-*`.
- `e2e/data-dir-lock.test.ts` holds node:test cases (ten, including a race of six processes for one stale lock). `playwright.config.ts` sets `testMatch: /\.spec\.ts$/` so Playwright does not import it, and root `npm test` runs it with `node --test`.
- On this host 127.0.0.1:8142 and 8143 are held by `rootlesskit`, the port forward of a rootless container, so do not pick an `E2E_PORT` that lands on them (directly, through the instance server at +1 or through the +50 disposable range). A taken port fails with `EADDRINUSE` when `webServer` starts; check with `ss -ltnp` first, then set `E2E_PORT` to a free port such as 8191.

<!-- Verified against the current code on 2026-10-16. -->

<!-- kk:related:start -->
# Related

- Related: [practice-visual-screenshot-baselines](../practice-visual-screenshot-baselines.md)
<!-- kk:related:end -->
