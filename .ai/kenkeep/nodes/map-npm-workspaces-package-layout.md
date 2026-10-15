---
type: map
title: 'npm workspaces: packages/common, packages/api, packages/web'
description: >-
  Three workspaces; common ships raw .ts subpath exports with no build; root
  scripts run from the repo root; every worktree needs npm install.
tags:
  - monorepo
  - workspaces
  - layout
  - tooling
  - common
  - api
  - web
kk_schema_version: 3
kk_id: map-npm-workspaces-package-layout
kk_derived_from: []
kk_relates_to:
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
The repo is an npm workspaces monorepo (`"workspaces": ["packages/*"]`):

- `packages/common` (`@timetrack/common`): code shared by the server and the browser. It has no build step; `package.json` `exports` map subpaths straight to `.ts` files (`@timetrack/common/time`, `/duration`, `/colors`). Import it by those subpaths, never by a relative path into the package.
- `packages/api` (`@timetrack/api`): the Node server, `src/` and `test/`.
- `packages/web` (`@timetrack/web`): the React app, with its own `index.html`, `public/`, `tsconfig.json` and `vite.config.ts`.

Root scripts (`dev`, `start`, `build`, `test`, `typecheck`, `test:e2e`, `bench:history`, `screenshots`, `icons`) run from the repo root. `packages/api/src/config.ts` resolves its defaults, `data` and `dist/web`, against the working directory, and the Vite `outDir` is `../../dist/web` relative to `packages/web`, so the build output and data directory sit at the repo root.

Node loads `@timetrack/common` by stripping types at run time, in the main process and in the report worker thread. This works only because `node_modules/@timetrack/common` is a workspace symlink that resolves to `packages/common`. Node refuses to strip types for files whose real path is under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Do not publish or copy common into `node_modules`.

A fresh git worktree has no `node_modules`, so run `npm install` inside it before running anything. Otherwise `@timetrack/*` does not resolve, or resolves to another checkout.

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
