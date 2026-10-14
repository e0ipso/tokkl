---
type: practice
title: Running the Playwright e2e suite
description: >-
  test:e2e builds first; each run gets its own data dir; auto fixtures wipe data
  and fail tests on runtime errors unless a spec allows them.
tags:
  - testing
  - e2e
  - playwright
  - workflow
kk_schema_version: 3
kk_id: practice-e2e-test-workflow
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
- `npm run test:e2e` runs `npm run build` and then `playwright test`, so specs exercise the current UI. `npm run test:e2e:install` installs the Chromium headless shell explicitly; nothing installs it implicitly.
- `e2e/global-setup.ts` fails fast when the expected browser is missing or `CHROMIUM_PATH` points at nothing. Set `CHROMIUM_PATH` to use another Chromium or chrome-headless-shell binary. On this host Playwright 1.64.1 expects headless-shell revision 1248 while the cache holds 1223, so set `CHROMIUM_PATH` or run the install script.
- `E2E_PORT` (default 8095) lets concurrent runs coexist. `playwright.config.ts` picks a fresh `TIMETRACK_E2E_DATA_DIR` under the OS temp directory per run and deletes it when the run exits, pass or fail; a preset `TIMETRACK_E2E_DATA_DIR` is used as is.
- The automatic fixture in `e2e/fixtures.ts` deletes entries (running or not), the trash, projects, clients and tags, and resets preferences before and after every test. Each spec must create the data it needs and cannot rely on another spec's leftovers.
- Every scenario also runs under the automatic `runtimeErrors` fixture (`RuntimeErrors` in `e2e/runtime-errors.ts`). It fails the test on uncaught page errors, console errors, responses with status 400 or higher, and failed requests. React logs errors caught by an ErrorBoundary through `console.error`, so those fail the test too. Chromium's "Failed to load resource" console lines are ignored because the response and requestfailed listeners already record the same failures.
- The guard has two exceptions. An `/api/` 403 on a request without a `tt_session` cookie passes, because the app probes `/api/v9/me` on load while logged out. A scenario that provokes a failure on purpose calls `runtimeErrors.allowResponse({ status, method, path, reason })` before triggering it; `path` is a RegExp and `reason` says why the failure is expected. Do not clear `runtimeErrors.issues` in scenarios. Only the canaries in `e2e/guard.spec.ts` do that.
- The static server answers unknown paths with the HTML app shell and status 200, so a 200 does not prove a static file exists. Check the content type, as `e2e/pwa.spec.ts` does for the manifest icons in `web/public/manifest.webmanifest`. That spec also checks that each icon decodes at its declared size and that `start_url` falls inside the scope; the manifest has no `scope` member, so the scope defaults to the directory of `start_url` (`/`).
