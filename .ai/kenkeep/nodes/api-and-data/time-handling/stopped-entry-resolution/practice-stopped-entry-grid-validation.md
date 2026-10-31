---
type: practice
title: Stopped entry grid validation
description: >-
  Stopped live entries use snapSpan and the instance grid; typed zero spans fail
  while unchanged spans remain editable.
tags:
  - server
  - time
  - entries
kk_schema_version: 3
kk_id: practice-stopped-entry-grid-validation
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12'
kk_relates_to:
  - map-instance-settings-api-app-admin-settings-and-setting-rules
  - practice-parse-api-timestamps-with-parseinstant
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
`snapSpan` in `packages/common/snap.ts` is the one rule, and `settleSpan` and `stopEntryAt` in `packages/api/src/domain/timeEntries.ts` apply it. Every live write of a stopped entry (create, edit, bulk PATCH, stop, switching timers, and undoing the delete of a running entry while another runs) is snapped to the instance setting `time_resolution_minutes` (default 5; see `map-instance-settings-api-app-admin-settings-and-setting-rules`). Do not add a write path that stores a stopped span without going through them, and do not add a second rounding rule beside it: typed spans and timer stops used to round differently (round-up duration, a one-step floor on the stop endpoint) and that split was removed on purpose.

- Inputs are cut to whole seconds first. The start and the stop each move to the nearest grid point on the owner's wall clock (`snapInstant`), a tie going later. Either end moves by at most half a step, so a stored entry can be up to one step shorter or longer than the real span. Do not assert that a stopped timer is at least as long as it ran.
- `snapSpan` returns null when the span is too short to keep: it lasted less than half a step, or both ends snap to the same point (at R=5, 10:02:31 to 10:07:29 does). The first condition catches a few-second timer that straddles a half-step mark, which would otherwise snap to one step.
- Create, edit and bulk PATCH answer 400 `Time entry is too short: it rounds to zero at the N-minute time resolution` for a too-short span, unless the edit leaves the stored start and stop alone (`unchanged` in `settleSpan`): then the stored times stay, so an older zero-length entry can still be renamed or retagged.

<!-- kk:related:start -->
# Related

- Related: [map-instance-settings-api-app-admin-settings-and-setting-rules](../../users-and-admin/map-instance-settings-api-app-admin-settings-and-setting-rules.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](../practice-parse-api-timestamps-with-parseinstant.md)
- Related: [practice-web-previews-and-editor-show-snapped-durations](../../../web-ui-behaviour/time-and-timers/practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12
<!-- kk:citations:end -->
