---
type: map
title: What npm test and npm run typecheck cover
description: >-
  npm test runs every packages/*/**/*.test.ts; packages/web unit tests cover pure .ts modules only; no lint script; typecheck runs four tsconfigs.
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
  - map-npm-workspaces-package-layout
kk_depends_on: []
kk_confidence: high
---
`npm test` runs `node --test` from the repo root over `packages/*/**/*.test.ts`, which picks up `packages/api/test`, the tests next to `packages/common/*.ts` and `packages/web/src/**/*.test.ts`. Each package also has its own `test` script over its own files.

Unit tests in `packages/web` can only import plain `.ts` modules, because Node strips types from `.ts` but cannot load `.tsx`. Logic worth unit testing is pulled out of components into a `.ts` file next to them, as with `pages/manage/swatchCheck.ts`, `api/entriesPlaceholder.ts` and `components/arrowKeys.ts`. Anything that needs a DOM or React goes through the Playwright e2e suite.

There is no lint script. `npm run typecheck` is the static analysis gate. It runs `tsc` four times:

- `tsconfig.json`: `packages/**/*.ts` and `bench/**/*.ts`, excluding `packages/web/**`, so web code is checked once, with its own JSX and DOM settings.
- `packages/web/tsconfig.json`: `packages/web/src` and `packages/web/vite.config.ts`.
- `e2e/tsconfig.json`: extends the root settings (`strict`, `erasableSyntaxOnly`), adds the DOM libs, and covers `e2e/**/*.ts` and `playwright.config.ts`.
- `scripts/tsconfig.json`: extends the root settings, adds the DOM libs, and covers `scripts/**/*.ts` (the screenshot and icon scripts).

Playwright strips types without checking them, so this is the only place e2e type errors are caught. The root config sets `erasableSyntaxOnly`, and the e2e and scripts configs inherit it, because Node runs `.ts` files by stripping types: enums and constructor parameter properties fail with TS1294 in `packages/api`, `packages/common`, `bench`, `e2e` and `scripts`. Declare class fields and assign them in the constructor instead. `packages/web/tsconfig.json` does not set the flag.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
- Related: [map-npm-workspaces-package-layout](map-npm-workspaces-package-layout.md)
<!-- kk:related:end -->
