---
type: map
title: What npm test and npm run typecheck cover
description: >-
  npm test runs only server/test and shared tests; web/src logic is tested via
  shared helpers or e2e; no lint script; typecheck covers server, web, e2e, bench.
tags:
  - testing
  - typecheck
  - tooling
  - workflow
kk_schema_version: 3
kk_id: map-test-and-static-analysis-layout
kk_derived_from: []
kk_relates_to:
  - practice-e2e-test-workflow
kk_depends_on: []
kk_confidence: high
---
`npm test` runs `node --test` over `server/test/**/*.test.ts` and `shared/**/*.test.ts` only. Code under `web/src` (including `web/src/lib`) has no unit tests in that glob; logic that needs unit tests belongs in `shared/`, otherwise cover it through the Playwright e2e suite.

There is no lint script. `npm run typecheck` is the static analysis gate. It runs `tsc` three times:

- `tsconfig.json`: `server`, `shared` and `bench`.
- `web/tsconfig.json`: `web/src`, `shared` and `web/vite.config.ts`.
- `e2e/tsconfig.json`: extends the root settings (`strict`, `erasableSyntaxOnly`), adds the DOM libs, and covers `e2e/**/*.ts` and `playwright.config.ts`.

Playwright strips types without checking them, so this is the only place e2e type errors are caught. The root and e2e configs set `erasableSyntaxOnly` because Node runs `.ts` files by stripping types: enums and constructor parameter properties fail with TS1294 in `server`, `shared`, `bench` and `e2e`. Declare class fields and assign them in the constructor instead. `web/tsconfig.json` does not set the flag.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
