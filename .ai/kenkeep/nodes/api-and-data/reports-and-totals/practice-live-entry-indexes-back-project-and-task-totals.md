---
type: practice
title: Project and task totals rely on the live-entry partial indexes
description: >-
  Migration 2 adds time_entries_project_live and time_entries_task_live; totals
  SQL must keep using them.
tags:
  - server
  - database
  - migrations
  - performance
kk_schema_version: 3
kk_id: practice-live-entry-indexes-back-project-and-task-totals
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:6'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Project and task totals sum live entries per project or task. Migration2 in `packages/api/src/storage/migrations.ts` adds `time_entries_project_live` and `time_entries_task_live` using the definitions in `storage/schema.ts`. SQLite/PostgreSQL use partial indexes; MySQL/MariaDB use dialect-compatible covering indexes. The production query builders live in `storage/queries/catalogs.ts` and repositories in `storage/repositories/catalogs.ts`.

Keep the live-entry and project/task scope predicates compatible with the indexes. Real-engine integration and history-benchmark EXPLAIN checks require actual chosen indexed totals access, not a candidate index or forced planner setting. Small bounded catalog reference scans are distinct from entry-history scans.

Migrations are append-only definitions. `initializeDatabase` applies them under migration ownership and validates the `storage_migrations` checksum/state/schema ledger. Never edit an applied definition. Add a new migration and verify earlier recognized ledgers upgrade on every engine.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:6
<!-- kk:citations:end -->
