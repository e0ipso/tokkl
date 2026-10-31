---
type: practice
title: Entry resolution at DST imports and reports
description: >-
  DST changes, report rounding and exact imports have distinct resolution
  behavior and shared fixture coverage.
tags:
  - server
  - time
  - import
kk_schema_version: 3
kk_id: practice-entry-resolution-at-dst-imports-and-reports
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12'
kk_relates_to:
  - practice-json-restore-rules
  - practice-toggl-csv-import-selects-users-by-opaque-key
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
`snapSpan` in `packages/common/snap.ts` supplies live-write rounding; imports retain exact stored instants.

- Near a UTC-offset change, `nearestGridPoint` builds grid candidates from the offsets on both sides and keeps only those on the grid at their own offset, which also drops wall-clock times a DST gap skips. Across a half-hour change at R=60 (`Australia/Lord_Howe`) a stored span is not a multiple of R; that is expected. Test cases live in `packages/common/fixtures/snap.json`.
- Report rounding (PRD R8) applies on top of the stored values. Whenever the report step is not a multiple of the resolution, a report shows durations that are not multiples of the resolution, in every rounding mode. That is expected, not a snapping bug.
- Existing entries are not migrated. They snap the next time they are edited.
- `importCsv` and `importJson` pass `{ exact: true }` and keep their times, zero-length ones included. Snapping them would break the de-duplication that matches on start and stop, so a second import would add copies. e2e seeds legacy zero-length entries through the CSV import (`TestData.createZeroLengthEntry` in `e2e/fixtures.ts`).

Tests that need exact times set the resolution to 1 through `PUT /api/app/admin/settings`. See `practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts` for the e2e helper.

<!-- kk:related:start -->
# Related

- Related: [practice-json-restore-rules](../../toggl-compat-and-import/practice-json-restore-rules.md)
- Related: [practice-toggl-csv-import-selects-users-by-opaque-key](../../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md)
- Related: [practice-web-previews-and-editor-show-snapped-durations](../../../web-ui-behaviour/time-and-timers/practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12
<!-- kk:citations:end -->
