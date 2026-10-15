---
type: practice
title: 'JSON restore: idempotent, skips with reasons, keeps archive state'
description: >-
  importJsonExport skips records it cannot map with a reason, never replaces a
  running timer, and re-archives projects after task import.
tags:
  - server
  - import
  - restore
  - backup
kk_schema_version: 3
kk_id: practice-json-restore-rules
kk_derived_from: []
kk_relates_to:
  - practice-write-paths-validate-refs-not-totals
  - practice-parse-api-timestamps-with-parseinstant
kk_depends_on: []
kk_confidence: high
---
`importJsonExport` in `packages/api/src/services/importJson.ts` restores a Timetrack JSON export. Restoring the same file twice changes nothing: clients, projects, tasks and tags are matched by name, and entries with the same start, stop, description and project are skipped.

- Projects are created through `createProject` with their stored fields, including `start_date` and `is_private`.
- A record that points at a non-null project, task or other entity that was not imported is skipped with the reason `Its <entity> <id> was not imported`.
- A running entry is skipped and reported while another timer runs here. Stopping that timer and restoring again imports it.
- `createTask` refuses archived projects, so task import reactivates an archived project, creates the task, and re-archives it in a `finally` block.
- Entry `start`/`stop` go through `parseInstant`.

<!-- kk:related:start -->
# Related

- Related: [practice-write-paths-validate-refs-not-totals](practice-write-paths-validate-refs-not-totals.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](practice-parse-api-timestamps-with-parseinstant.md)
<!-- kk:related:end -->
