---
type: practice
title: Validate write references with transaction-bound reference getters
description: >-
  Entry and catalog writes use scoped getRef contracts; full projections compute
  totals and stay off validation paths.
tags:
  - server
  - models
  - performance
  - validation
kk_schema_version: 3
kk_id: practice-write-paths-validate-refs-not-totals
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:5'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Entry and catalog writes validate references with the transaction-bound `ctx.projects.getRef(workspaceId, id)` and `ctx.tasks.getRef(workspaceId, id)` contracts. The implementation in `packages/api/src/storage/repositories/catalogs.ts` selects lightweight reference fields and does not compute history totals. Domain checks live in `domain/timeEntries.ts` and `domain/catalogs.ts`.

Full project/task projections compute tracked totals and belong in responses that need them. Import exact-entry writers preserve shared validation while using bounded callback-local reference caches; failed savepoints clear those caches. Do not substitute full totals projections on write validation paths.

Time entries may point at archived projects; entry writes do not require active projects. Task creation rejects archived projects.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:5
<!-- kk:citations:end -->
