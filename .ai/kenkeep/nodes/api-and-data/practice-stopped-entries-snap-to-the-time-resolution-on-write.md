---
type: practice
title: Stopped entries snap to the instance time resolution on write
description: >-
  Live writes snap start and duration to time_resolution_minutes in the owner's
  zone; imports and JSON restore stay exact.
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
kk_depends_on: []
kk_confidence: high
---
`snapSpan` in `packages/common/snap.ts` is the one rule, and `settleSpan` and `stopEntryAt` in `packages/api/src/models/timeEntries.ts` apply it. Every live write of a stopped entry (create, edit, stop, and undoing a delete) is snapped to the instance setting `time_resolution_minutes` (default 5; see `map-admin-api-and-disabled-accounts`). Do not add a write path that stores a stopped span without going through them.

- Inputs are cut to whole seconds first. The stored duration is the real duration rounded up to a multiple of the resolution R. The start goes to the nearest grid point on the owner's wall clock, and a tie goes later. The stop is the snapped start plus the rounded duration in elapsed time, so a span across a DST change keeps its length. A same-second start and stop is a zero-length entry on a grid point.
- A running entry keeps its exact start until it stops. Undoing the delete of a running entry stops it if another timer started meanwhile, and that stop snaps too.
- The 999 h cap is checked after snapping. 999 h is a multiple of every allowed R, so snapping never pushes a valid entry over it by rounding alone.
- When a new timer stops the old one, the two can overlap by up to 1.5R, not R: the start can move half a step earlier and the duration can gain almost a step.
- Existing entries are not migrated. They snap the next time they are edited.
- `importCsv` and `importJson` pass `{ exact: true }` and keep their times. Snapping them would break the de-duplication that matches on start and stop, so a second import would add copies.

Tests that need exact times set the resolution to 1 through `PUT /api/app/admin/settings`. See `practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts` for the e2e helper.

<!-- kk:related:start -->
# Related

- Related: [map-admin-api-and-disabled-accounts](map-admin-api-and-disabled-accounts.md)
- Related: [practice-json-restore-rules](practice-json-restore-rules.md)
- Related: [practice-toggl-csv-import-selects-users-by-opaque-key](practice-toggl-csv-import-selects-users-by-opaque-key.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](practice-parse-api-timestamps-with-parseinstant.md)
<!-- kk:related:end -->
