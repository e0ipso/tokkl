---
type: map
title: Catalog revision and latest entry endpoints for caching clients
description: >-
  GET /api/app/workspaces/{wid}/catalog counts project-list writes in
  workspaces.catalog_revision; GET /api/app/time_entries/latest answers the
  newest entry by start.
tags:
  - server
  - projects
  - clients
  - desktop
kk_schema_version: 3
kk_id: map-catalog-revision-and-latest-entry-endpoints
kk_derived_from: []
kk_relates_to:
  - practice-client-deletion-keeps-projects
  - practice-write-paths-validate-refs-not-totals
kk_depends_on: []
kk_confidence: high
---
`GET /api/app/workspaces/{wid}/catalog` answers `{ "revision": <int> }` (`CatalogRevision` in `packages/types`) to a member and the usual 403 to anyone else. The number is `workspaces.catalog_revision`, added by migration 8 (`catalogRevisionDDL` and `addedColumns` in `storage/schema.ts`, default 0).

The bump lives in the repositories, the one place every project and client write passes through: `bumpCatalogRevision` in `storage/repositories/catalog-sql.ts` runs after each write in `projects.ts` (create, update, delete) and `clients.ts` (create, update, setArchived, restore, deleteAndDetachProjects). Imports and JSON restore create clients and projects through the same methods, so they bump too, and a dry run rolls the bump back with everything else. `workspaces.update` bumps only when `default_currency` changes, because every project in the list carries `workspace_default_currency`; the `catalog_revision` assignment comes first in its SET because MySQL assigns left to right. Every caller already holds the workspace row lock (`lockWorkspaces`), so the extra UPDATE waits on nothing new. Totals (`actual_hours`, `actual_seconds`) and the date-driven `status` are deliberately left out: entry writes never bump. A new write path to `projects` or `clients` must go through these repository methods or call `bumpCatalogRevision` itself; `test/catalogRevision.test.ts` lists each path in its `WRITES` table.

`GET /api/app/time_entries/latest` answers the user's newest live entry by start, running or stopped, in any workspace, or `null`: the first entry `/me/time_entries` lists, with `meta: true` fields, via `latestEntry` in `domain/queries.ts` (`entries.list` with `limit: 1` on the `user_id, start` index). The desktop's next-start selection (`desktop/core/src/nextstartselection.cpp`, `fromRecentEntries`) takes exactly that entry and keeps its project only when it is in the current workspace and active.

`GET /api/app/status` announces them as `catalog-revision` and `latest-entry` (`CAPABILITIES` in `presenters/serverApi.ts`), so a client probes the capability instead of reading a 404. Each capability name is pinned in several places that change together: `ServerCapability` in `packages/types`, `KNOWN_CAPABILITIES` in `packages/web/src/api/replies.ts` (it does not compile without every name), `SERVER_API` in `test/helpers.ts`, the list and the `PROBES` in `test/serverApi.test.ts`, `FRESH_STATUS` in `e2e/auth-browser.spec.ts`, both status checks in `scripts/production-image-smoke.ts` and the capability list in `docs/PRD.md`. The web app's status decoder drops names it does not know, so a cached web build from before a new capability still reads the status of a server that announces it. Builds from before that decoder refused unknown names, and an e2e run against a stale `dist/web` fails the same way: rebuild before running specs after a capability change. The web app does not call either endpoint.
