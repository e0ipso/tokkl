---
type: practice
title: Stopped entries snap to the instance time resolution on write
description: >-
  Live writes snap to time_resolution_minutes in the owner's zone: typed spans
  round up, timer stops go to the nearest grid point; imports stay exact.
tags:
  - server
  - time
  - entries
  - import
kk_schema_version: 3
kk_id: practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_derived_from: []
kk_relates_to:
  - map-admin-api-and-disabled-accounts
  - practice-json-restore-rules
  - practice-toggl-csv-import-selects-users-by-opaque-key
  - practice-parse-api-timestamps-with-parseinstant
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
`snapSpan` in `packages/common/snap.ts` is the one rule, and `settleSpan` and `stopEntryAt` in `packages/api/src/models/timeEntries.ts` apply it. Every live write of a stopped entry (create, edit, stop, and undoing a delete) is snapped to the instance setting `time_resolution_minutes` (default 5; see `map-admin-api-and-disabled-accounts`). Do not add a write path that stores a stopped span without going through them.

- Typed and edited spans (create, edit, bulk PATCH) go through `snapSpan`. Inputs are cut to whole seconds first. The stored duration is the real duration rounded up to a multiple of the resolution R. The start goes to the nearest grid point on the owner's wall clock, and a tie goes later. The stop is the snapped start plus the rounded duration in elapsed time, so a span across a DST change keeps its length. A same-second start and stop is a zero-length entry on a grid point.
- Stopping a running timer does not round up. `stopEntryAt` moves the start to its nearest grid point and stores the stop at the grid point nearest the stop instant (`nearestGridPoint`), or at the start if that is earlier. Switching timers (`stopRunning`, which a new start calls) and undoing the delete of a running entry while another timer runs use this rule, so a switch is stored back to back with the next entry, and a switch within half a step of the start stores a zero-length entry. Only the stop endpoint (`stopTimeEntry`) passes `oneStep`, which turns a stop that lands on the start into one step. The stored duration is a multiple of R but can be up to one step shorter than the real time, so do not assert that a stopped timer is at least as long as it ran.
- A running entry keeps its exact start until it stops. A stop and a later start sent a few seconds apart can leave a gap of R between them. They do not overlap unless the stop endpoint's one-step floor applied, which can carry the stop past the next timer's snapped start.
- The 999 h cap is checked after snapping. 999 h is a multiple of every allowed R, so snapping never pushes a valid entry over it by rounding alone. Create and edit reject a longer span, but `stopEntryAt` clamps it to exactly 999 h instead: a timer left running past the cap must still stop, because a failed stop would leave it running and every new start fails too (starting one stops the old one). The clamped span stays on the grid.
- Bulk PATCH (`/time_entries/:ids`) runs each operation through `updateTimeEntry`, so removing all tags or any other bulk edit snaps like a single edit.
- Near a UTC-offset change, `snapSpan` builds grid candidates from the offsets on both sides and keeps only those on the grid at their own offset, which also drops wall-clock times a DST gap skips. The nearest wins and a tie goes later. A zone with a half-hour change, `Australia/Lord_Howe`, is the test case (`packages/common/snap.test.ts`, `e2e/timer-resolution.spec.ts`).
- Report rounding (PRD R8) applies on top of the stored values. Whenever the report step is not a multiple of the resolution, a report shows durations that are not multiples of the resolution, in every rounding mode. That is expected, not a snapping bug.
- Existing entries are not migrated. They snap the next time they are edited.
- `importCsv` and `importJson` pass `{ exact: true }` and keep their times. Snapping them would break the de-duplication that matches on start and stop, so a second import would add copies.

Tests that need exact times set the resolution to 1 through `PUT /api/app/admin/settings`. See `practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts` for the e2e helper.

<!-- kk:related:start -->
# Related

- Related: [map-admin-api-and-disabled-accounts → map-admin-user-management-api-and-the-last-active-admin-rule](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md)
- Related: [map-admin-api-and-disabled-accounts → map-instance-settings-api-app-admin-settings-and-setting-rules](../users-and-admin/map-instance-settings-api-app-admin-settings-and-setting-rules.md)
- Related: [map-admin-api-and-disabled-accounts → map-invites-and-password-reset-links-in-account-tokens](../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
- Related: [practice-json-restore-rules](../toggl-compat-and-import/practice-json-restore-rules.md)
- Related: [practice-toggl-csv-import-selects-users-by-opaque-key](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](practice-parse-api-timestamps-with-parseinstant.md)
- Related: [practice-web-previews-and-editor-show-snapped-durations](../../web-ui-behaviour/practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->
