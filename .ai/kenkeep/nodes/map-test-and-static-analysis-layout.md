---
type: map
title: What npm test and npm run typecheck cover
description: >-
  npm test runs only server/test and shared tests; web/src logic is tested via
  shared helpers or e2e; no lint script; typecheck skips e2e.
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

There is no lint script. `npm run typecheck` (`tsc` over the root `tsconfig.json`, which includes `server` and `shared`, then `web/tsconfig.json`, which includes `web/src`, `shared` and `web/vite.config.ts`) is the static analysis gate. Neither config includes `e2e/*.ts` or `playwright.config.ts`, so `npm run typecheck` does not catch type errors there; Playwright strips types without checking them.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
