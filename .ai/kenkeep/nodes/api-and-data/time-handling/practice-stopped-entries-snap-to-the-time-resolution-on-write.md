---
type: practice
title: Stopped entries snap to the instance time resolution on write
description: >-
  Every live write moves start and stop each to the nearest grid point; a span
  that rounds to zero is refused (typed) or trashed (timer stop); imports stay
  exact.
tags:
  - server
  - time
  - entries
  - import
kk_schema_version: 3
kk_id: practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3'
kk_relates_to:
  - map-admin-user-management-api-and-the-last-active-admin-rule
  - map-invites-and-password-reset-links-in-account-tokens
  - map-instance-settings-api-app-admin-settings-and-setting-rules
  - practice-json-restore-rules
  - practice-toggl-csv-import-selects-users-by-opaque-key
  - practice-parse-api-timestamps-with-parseinstant
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
`snapSpan` in `packages/common/snap.ts` is the one rule, and `settleSpan` and `stopEntryAt` in `packages/api/src/models/timeEntries.ts` apply it. Every live write of a stopped entry (create, edit, bulk PATCH, stop, switching timers, and undoing the delete of a running entry while another runs) is snapped to the instance setting `time_resolution_minutes` (default 5; see `map-instance-settings-api-app-admin-settings-and-setting-rules`). Do not add a write path that stores a stopped span without going through them, and do not add a second rounding rule beside it: typed spans and timer stops used to round differently (round-up duration, a one-step floor on the stop endpoint) and that split was removed on purpose.

- Inputs are cut to whole seconds first. The start and the stop each move to the nearest grid point on the owner's wall clock (`snapInstant`), a tie going later. Either end moves by at most half a step, so a stored entry can be up to one step shorter or longer than the real span. Do not assert that a stopped timer is at least as long as it ran.
- `snapSpan` returns null when the span is too short to keep: it lasted less than half a step, or both ends snap to the same point (at R=5, 10:02:31 to 10:07:29 does). The first condition catches a few-second timer that straddles a half-step mark, which would otherwise snap to one step.
- Create, edit and bulk PATCH answer 400 `Time entry is too short: it rounds to zero at the N-minute time resolution` for a too-short span, unless the edit leaves the stored start and stop alone (`unchanged` in `settleSpan`): then the stored times stay, so an older zero-length entry can still be renamed or retagged.
- A timer stop that rounds to zero (stop endpoint, `stopRunning` on a new start, restore while another timer runs) soft-deletes the entry into the trash with start and stop both on the snapped start. The stop endpoint reads it back with `includeDeleted`, so the reply is the entry with `duration` 0 and `server_deleted_at` set. Released desktop clients add the reply's `duration` to their pause chain, so a few-second segment before a pause adds nothing without a client change. Undo from the trash brings back the zero-length entry.
- `PATCH /workspaces/:wid/time_entries/:id/stop` takes an optional JSON `stop` instant, validated by `parseInstant`; without one the stop is the request time. Both go through `stopEntryAt`, so snapping, the trash and Undo behave the same. The web app passes the instant when a Pomodoro session starts over a running timer.
- A running entry keeps its exact start until it stops. A new timer started at the switch instant later snaps its start to the same grid point as the old stop, so switches are stored back to back. A stop and a later start sent seconds apart can leave a gap of R, never an overlap.
- The 999 h cap is checked after snapping, so a stop under half a step past 999 h snaps back onto it and is accepted. Create and edit reject a longer span, but `stopEntryAt` clamps it to exactly 999 h instead: a timer left running past the cap must still stop, because a failed stop would leave it running and every new start fails too (starting one stops the old one).
- Near a UTC-offset change, `nearestGridPoint` builds grid candidates from the offsets on both sides and keeps only those on the grid at their own offset, which also drops wall-clock times a DST gap skips. Across a half-hour change at R=60 (`Australia/Lord_Howe`) a stored span is not a multiple of R; that is expected. Test cases live in `packages/common/fixtures/snap.json`.
- Report rounding (PRD R8) applies on top of the stored values. Whenever the report step is not a multiple of the resolution, a report shows durations that are not multiples of the resolution, in every rounding mode. That is expected, not a snapping bug.
- Existing entries are not migrated. They snap the next time they are edited.
- `importCsv` and `importJson` pass `{ exact: true }` and keep their times, zero-length ones included. Snapping them would break the de-duplication that matches on start and stop, so a second import would add copies. e2e seeds legacy zero-length entries through the CSV import (`TestData.createZeroLengthEntry` in `e2e/fixtures.ts`).

Tests that need exact times set the resolution to 1 through `PUT /api/app/admin/settings`. See `practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts` for the e2e helper.

<!-- kk:related:start -->
# Related

- Related: [map-admin-user-management-api-and-the-last-active-admin-rule](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md)
- Related: [map-invites-and-password-reset-links-in-account-tokens](../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
- Related: [map-instance-settings-api-app-admin-settings-and-setting-rules](../users-and-admin/map-instance-settings-api-app-admin-settings-and-setting-rules.md)
- Related: [practice-json-restore-rules](../toggl-compat-and-import/practice-json-restore-rules.md)
- Related: [practice-toggl-csv-import-selects-users-by-opaque-key](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](practice-parse-api-timestamps-with-parseinstant.md)
- Related: [practice-web-previews-and-editor-show-snapped-durations](../../web-ui-behaviour/time-and-timers/practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3
<!-- kk:citations:end -->
