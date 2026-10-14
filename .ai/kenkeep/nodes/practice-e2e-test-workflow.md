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

Writing specs:

- Spec files are named by area (`timer-*`, `history-*`, `groups-*`, `refresh-*`, `transfer-*`, `entities-*`, `report-*`, `auth-*`) and share helpers in a per-area `*-tests-helpers.ts` file (`timer-tests-helpers.ts`, `entity-tests-helpers.ts`, `report-tests-helpers.ts`, and so on). Put new scenarios in the matching area.
- The reset fixture does not touch week start, workspace rounding or rates. `report-tests-helpers.ts` exports a `test` whose `api` fixture (`ReportApi`) saves those settings before each test and restores them after; use it for anything that changes them.
- Transfer fixtures live in `e2e/fixtures-data/transfer`. `transferFixture(name, replacements)` in `transfer-tests-helpers.ts` fills `{{KEY}}` placeholders, for example with IDs created during the test.
- `auth-tests-helpers.ts` starts disposable servers on `E2E_PORT + 50` to `+ 59`. It can shift only that server's clock by passing `--import` with a `data:` URL module. Cookies are scoped by host, not port, so a disposable server on 127.0.0.1 shares `tt_session` with the main test server inside one browser context.
- `getByRole`/`getByLabel` name matching is a case-insensitive substring match unless you pass `exact: true`.
- A synthetic `visibilitychange` must be dispatched with `{ bubbles: true }` when fired on `document`, because the focus listener in `web/src/main.tsx` listens on `window`.
- For timer-driven behaviour use `page.clock.install()` with `fastForward`. Do not use `clock.pauseAt`: TanStack Query's notify scheduler uses `setTimeout(0)`, which then never fires and queries stop updating the UI.
- On this host 127.0.0.1:8142 and 8143 are held by a rootless Docker listener, so do not pick an `E2E_PORT` that lands on them (directly or through the +50 disposable range).
