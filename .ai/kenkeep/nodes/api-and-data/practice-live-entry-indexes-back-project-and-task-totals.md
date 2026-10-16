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
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Project and task tracked-time totals sum live (not deleted) entries per project or task. The second entry of `MIGRATIONS` in `packages/api/src/db/migrations.ts` adds the partial covering indexes `time_entries_project_live` and `time_entries_task_live` (`project_id`/`task_id`, `start`, `stop`, `deleted_at`, `WHERE deleted_at IS NULL AND project_id IS NOT NULL`, or `task_id IS NOT NULL`), so SQLite answers those sums from the index instead of scanning the whole history.

`packages/api/test/entities.test.ts` runs `EXPLAIN QUERY PLAN` on the totals queries and asserts they use these indexes. If you change the shape of the totals SQL, keep the `deleted_at IS NULL` and `project_id`/`task_id` predicates the partial indexes match, or the test fails.

Migrations are an append-only array; `openDatabase` in `packages/api/src/db/index.ts` applies entries past `PRAGMA user_version` and bumps it. Add schema changes as a new array entry, never by editing an applied one. The test that opens a version 1 database checks `user_version` against both `MIGRATIONS.length` and the literal count (5), so a new migration also updates that number.
