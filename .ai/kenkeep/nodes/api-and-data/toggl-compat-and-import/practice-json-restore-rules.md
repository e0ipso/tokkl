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
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:11'
kk_relates_to:
  - practice-write-paths-validate-refs-not-totals
  - practice-parse-api-timestamps-with-parseinstant
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
`importJsonExport` in `packages/api/src/services/importJson.ts` restores a JSON export whose `format` is `tokkl-export` or the pre-rename `timetrack-export` (`EXPORT_FORMAT` and `LEGACY_EXPORT_FORMAT` in `packages/api/src/services/exports.ts`). Restoring the same file twice changes nothing: clients, projects, tasks and tags are matched by name, and entries with the same start, stop, description and project are skipped.

- Records go into the user's `default_workspace_id`, resolved through `memberWorkspace`, so a user who is no longer a member of that workspace gets a 403 and nothing is written. The export likewise covers only the workspaces the user belongs to (`transfers.exportHead`).
- Both imports take a place from `services/importAdmission.ts` before the route reads the body: four per instance and one per account by default. A place also counts the file's bytes, from `Content-Length` (the whole 8 MiB limit when the body declares none): the running imports hold at most 8 MiB together (`maxBytes`), so a second file runs only beside files that leave room for it. A refused import gets 503 `Too many imports are running` with `Retry-After: 5`. The place stays taken until the request closed and every lent piece of work settled, a rollback after the deadline included.
- Before taking a place, `chargeStart` in `routes/imports.ts` charges the account's `importLimiter` (`FailureLimiter` namespace `import`, built in `app.ts`): five starts per 15 minutes (`IMPORT_START_LIMIT`, `IMPORT_START_WINDOW_MS` in `auth/rateLimit.ts`), stored in the database, so every instance shares it. Every start counts, previews, failed imports and 503 busy refusals included, and success resets nothing. The sixth gets 429 `Too many imports; try again later` with `Retry-After`. The key is the account id and creation instant, because SQLite can give a deleted account's id to the next one. Tests that start more than five imports use one account per scenario; the e2e fixture gives every desktop scenario its own admin for this reason.
- Imports stay all-or-nothing, but the file is not held three times. `routes/imports.ts` takes the body out of `req.body`, and the handlers start the import in a plain function and await only its promise, so neither the request nor a suspended handler keeps the text. A JSON file is parsed there and only the parsed object reaches the transaction. `importTogglCsv` is deliberately not `async`: the CSV text lives only as long as `readTogglCsv` parses it, and the transaction gets the table.
- The route refuses an encoded body (415, `refuseEncodedBody` in `http/request.ts`, shared with every API route) and a declared length over 8 MiB (413) before it charges a start or takes a place. `receiveWithin` in `routes/imports.ts` gives the upload 60 s from admission (408, request destroyed) and the parser 413s a received body over 8 MiB. The import's signal is the request's `workSignal` joined with a five-second deadline counted from the last byte on the monotonic clock. `checkCancelled` runs before each record or row, outside its savepoint (which would report the cancellation as that record's error), and `cancelBeforeCommit` checks once more in `readAtCommit`. A disconnect (`RequestCancelled`) or the deadline (`ImportDeadlineExceeded`, 503 with `Retry-After: 60`) rolls back whole. The checks are cooperative: a running query or rollback can outlast the deadline.
- Projects are created through `createProject` with their stored fields, including `start_date` and `is_private`.
- A record that points at a non-null project, task or other entity that was not imported is skipped with the reason `Its <entity> <id> was not imported`.
- A running entry is skipped and reported while another timer runs here. Stopping that timer and restoring again imports it.
- `createTask` refuses archived projects, so task import reactivates an archived project, creates the task, and re-archives it in a `finally` block.
- Entry `start`/`stop` go through `parseInstant` and are stored exactly as in the file, not snapped to the time resolution. Snapping would move times and break the de-duplication above; see `practice-stopped-entries-snap-to-the-time-resolution-on-write`.

<!-- kk:related:start -->
# Related

- Related: [practice-write-paths-validate-refs-not-totals](../reports-and-totals/practice-write-paths-validate-refs-not-totals.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](../time-handling/practice-parse-api-timestamps-with-parseinstant.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:11
<!-- kk:citations:end -->
