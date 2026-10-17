---
type: practice
title: Web previews and the entry editor show the snapped duration
description: >-
  Previews use snappedSeconds and snappedInstant with the /me resolution; toasts
  and chained starts use the server-returned entry.
tags:
  - web
  - time
  - timer
  - entries
kk_schema_version: 3
kk_id: practice-web-previews-and-editor-show-snapped-durations
kk_derived_from: []
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - practice-ui-time-math-uses-wall-clock-helpers
  - map-admin-api-and-disabled-accounts
kk_depends_on: []
kk_confidence: high
---
The server snaps every stopped entry (see `practice-stopped-entries-snap-to-the-time-resolution-on-write`), so the web UI shows what will be stored, not what was typed. `snappedSeconds(start, stop, settings)` and `snappedInstant(at, settings)` in `packages/web/src/lib/settings.ts` wrap `snapSpan` from `packages/common/snap.ts` and cut inputs to whole seconds first. `settings.timeResolution` comes from `time_resolution_minutes` in `/me` and is 1 until `/me` has loaded, so a preview before then is exact.

- `TimerBar.tsx` previews the manual range and a typed duration with `snappedSeconds`. `EntryEditor.tsx` shows the snapped duration, and rewrites a typed duration to its snapped value on blur.
- A running timer keeps `entrySeconds`: a running entry holds its exact start until it stops.
- The "Added" toast shows the entry the server returned, not the range that was sent. `addManual` also chains the next start (or the next day after midnight) from the returned entry's stop, because starting at the typed end could overlap the stored entry.
- The split in `EntryEditor.tsx` snaps the split instant once with `snappedInstant`, so both halves share one grid point. It refuses a split that lands on the start or the stop after snapping ("The split time must fall inside the entry"). Known open: the two halves can still overlap across a DST change of a fractional hour.

e2e: `e2e/timer-resolution.spec.ts` is in `INSTANCE_SPECS` in `playwright.config.ts` because it changes the instance resolution. It uses the `test` from `e2e/admin-tests-helpers.ts`, whose `instance` fixture saves the instance settings and restores them. `NewUser` in `e2e/fixtures.ts` takes an optional `timezone` (default `Europe/Madrid`) for zones such as `Australia/Lord_Howe`, and `TimerApi.startTimer` in `e2e/timer-tests-helpers.ts` seeds a running entry.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../api-and-data/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
- Related: [practice-ui-time-math-uses-wall-clock-helpers](practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [map-admin-api-and-disabled-accounts](../api-and-data/map-admin-api-and-disabled-accounts.md)
<!-- kk:related:end -->
