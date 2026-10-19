---
type: map
title: What npm test and npm run typecheck cover
description: "npm test runs the workspaces then the e2e and scripts node tests; typecheck adds e2e, scripts and bench; tsconfigs extend tsconfig.base.json; no lint."
tags:
  - testing
  - typecheck
  - tooling
  - workflow
kk_schema_version: 3
kk_id: map-test-and-static-analysis-layout
kk_derived_from: []
kk_relates_to:
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
  - map-npm-workspaces-package-layout
kk_depends_on: []
kk_confidence: high
---
`npm test` runs `npm run test --workspaces --if-present`. `packages/api` (`test/**/*.test.ts`), `packages/common` (`*.test.ts`) and `packages/web` (`src/**/*.test.ts`) each run `node --test` over their own files; `packages/types` has no tests. After the workspaces, the root script runs `node --test --test-reporter=spec 'e2e/**/*.test.ts' 'scripts/**/*.test.ts' 'desktop/gnome/extension/**/*.test.js'`, so node:test files under `e2e/` (today `e2e/data-dir-lock.test.ts`), under `scripts/` (today `check-tracker-refs.test.ts`, `commitlint.test.ts`, `icons.test.ts`, which checks the committed wordmark PNGs without ImageMagick (see [map-app-icons-script](../repo-and-scripts/map-app-icons-script.md)), and the release-only code tests `release-publish.test.ts`, which runs steps of `ci.yml` against a stub `gh`, `kde-semantic-release.test.ts`, `kde-previous-package.test.ts` and `kde-image-id.test.ts`; see [map-kde-ci-and-release-pipeline](../kde-companion/map-kde-ci-and-release-pipeline.md)) and the GNOME extension's pure-JS tests run in `npm test`; Playwright specs stay `*.spec.ts` and run only through `npm run test:e2e`. `npm run build` works the same way, and only `packages/web` has a build.

Unit tests in `packages/web` can only import plain `.ts` modules, because Node strips types from `.ts` but cannot load `.tsx`. Logic worth unit testing is pulled out of components into a `.ts` file next to them, as with `pages/manage/swatchCheck.ts`, `api/entriesPlaceholder.ts` and `components/arrowKeys.ts`. Anything that needs a DOM or React goes through the Playwright e2e suite.

There is no lint script. `npm run typecheck` is the static analysis gate. It runs each workspace's `typecheck` script (`tsc -p tsconfig.json` in `packages/api`, `packages/common`, `packages/types` and `packages/web`), then `tsc -p` on `e2e/tsconfig.json` (`e2e/**/*.ts` and `playwright.config.ts`), `scripts/tsconfig.json`, `bench/tsconfig.json` and `desktop/kde/tests/tsconfig.json`. Playwright strips types without checking them, so this is the only place e2e type errors are caught.

All eight configs extend `tsconfig.base.json`, which holds the shared compiler options (`strict`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess` and others). Each config adds only its `lib`, module settings and `include`; web adds the DOM libs and JSX. There is no root `tsconfig.json`, so a bare `tsc` at the repo root prints its help and exits 1; use `npm run typecheck` or `tsc -p <config>`.

Every config inherits `erasableSyntaxOnly` because Node runs `.ts` files by stripping types: enums and constructor parameter properties fail with TS1294. Declare class fields and assign them in the constructor instead.

<!-- kk:related:start -->
# Related

- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
- Related: [map-npm-workspaces-package-layout](../repo-and-scripts/map-npm-workspaces-package-layout.md)
<!-- kk:related:end -->
