---
type: map
title: 'npm workspaces: packages/common, packages/api, packages/web, packages/types'
description: "Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree."
tags:
  - monorepo
  - workspaces
  - layout
  - tooling
  - common
  - api
  - web
  - types
kk_schema_version: 3
kk_id: map-npm-workspaces-package-layout
kk_derived_from: []
kk_relates_to:
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
The repo is an npm workspaces monorepo (`"workspaces": ["packages/*"]`):

- `packages/common` (`@tokkl/common`): code shared by the server and the browser. It has no build step; `package.json` `exports` map subpaths straight to `.ts` files (`@tokkl/common/time`, `/duration`, `/colors`). Import it by those subpaths, never by a relative path into the package.
- `packages/api` (`@tokkl/api`): the Node server, `src/` and `test/`.
- `packages/web` (`@tokkl/web`): the React app, with its own `index.html`, `public/`, `tsconfig.json` and `vite.config.ts`.
- `packages/types` (`@tokkl/types`): type-only declarations in one `index.ts`, the JSON shapes the web app reads from and sends to the API plus value shapes used by common. It must hold no runtime code (no enums, no values), so every import is `import type` and erases when Node strips types. `packages/web/src/api/types.ts` re-exports all of it. The server imports only the types its output matches exactly (`DurationFormat`, `ImportResult`). `Task.tracked_seconds` is in milliseconds despite the name, copying Toggl.

Root scripts (`dev`, `start`, `build`, `test`, `typecheck`, `test:e2e`, `bench:history`, `screenshots`, `icons`) run from the repo root. `packages/api/src/config.ts` resolves its defaults, `data` and `dist/web`, against the working directory, and the Vite `outDir` is `../../dist/web` relative to `packages/web`, so the build output and data directory sit at the repo root.

Node loads `@tokkl/common` by stripping types at run time, in the main process and in the report worker thread. This works only because `node_modules/@tokkl/common` is a workspace symlink that resolves to `packages/common`. Node refuses to strip types for files whose real path is under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Do not publish or copy common into `node_modules`.

A fresh git worktree has no `node_modules`, so run `npm install` inside it before running anything. Otherwise `@tokkl/*` does not resolve, or resolves to another checkout.

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
