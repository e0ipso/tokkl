---
type: practice
title: Running the Playwright e2e suite
description: >-
  npm run test:e2e builds the UI first; each run gets its own data dir; an auto
  fixture wipes data around every test, so specs seed their own.
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
