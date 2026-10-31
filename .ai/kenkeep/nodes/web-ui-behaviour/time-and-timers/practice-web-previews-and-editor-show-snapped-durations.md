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
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - practice-ui-time-math-uses-wall-clock-helpers
  - map-admin-user-management-api-and-the-last-active-admin-rule
  - map-invites-and-password-reset-links-in-account-tokens
  - map-instance-settings-api-app-admin-settings-and-setting-rules
kk_depends_on: []
kk_confidence: high
---
The server snaps every stopped entry (see `practice-stopped-entries-snap-to-the-time-resolution-on-write`), so the web UI shows what will be stored, not what was typed. `snappedSeconds(start, stop, settings)` and `snappedInstant(at, settings)` in `packages/web/src/lib/settings.ts` wrap `snapSpan` and `snapInstant` from `packages/common/snap.ts` and cut inputs to whole seconds first. `snappedSeconds` is 0 for a span the server would refuse as too short. `settings.timeResolution` comes from `time_resolution_minutes` in `/me` and is 1 until `/me` has loaded, so a preview before then is exact.

- `TimerBar.tsx` previews the manual range and a typed duration with `snappedSeconds`. `EntryEditor.tsx` shows the snapped duration, and rewrites a typed duration to its snapped value on blur.
- A running timer keeps `entrySeconds`: a running entry holds its exact start until it stops.
- The "Added" toast shows the entry the server returned, not the range that was sent. `addManual` also chains the next start (or the next day after midnight) from the returned entry's stop, because starting at the typed end could overlap the stored entry.
- The split settles both halves the way the server will. `snappedSplit(start, stop, at, settings)` in `packages/web/src/lib/settings.ts` snaps the whole entry (`snapSpan`, from the entry's own span) and cuts it at the grid point nearest `at`. Every boundary is a grid point, so the server keeps both halves as sent, and an entry saved under an older resolution splits into halves that fill the span it would store today. It returns `'outside'` ("The split time must fall inside the entry") when the cut is not strictly inside the snapped whole or the whole rounds to zero. There is no clock-change refusal any more: with both ends snapped to the nearest point, halves always meet, also across Lord Howe Island's half hour at a resolution of 60.

- The week calendar drags in steps of `dragStep(resolution)` from `packages/web/src/lib/calendarDay.ts`: the smallest multiple of the resolution that is at least 15 minutes (15 for R of 1, 3, 5 and 15; 16 for 2 and 4; 18 for 6; 20 for 10 and 20; 24 for 12; 30 for 30; 60 for 60). It is also the shortest block a resize leaves. A dropped boundary goes to the nearest grid point (`snappedInstant` in `WeekCalendar.tsx`, `droppedMinute` for the drawn preview), so an entry imported off the grid lands on it. A move sends the dropped start plus the duration the server stores for the entry (`snappedSeconds`), so an off-grid entry moves as the span it would snap to. A resize sends only the stop; the server snaps an off-grid start on its own.

e2e: `e2e/timer-resolution.spec.ts` and `e2e/history-calendar-resolution.spec.ts` are in `INSTANCE_SPECS` in `playwright.config.ts` because they change the instance resolution. Both use the `test` from `e2e/admin-tests-helpers.ts`, whose `instance` fixture saves the instance settings and restores them. `NewUser` in `e2e/fixtures.ts` takes an optional `timezone` (default `Europe/Madrid`) for zones such as `Australia/Lord_Howe`, and `TimerApi.startTimer` in `e2e/timer-tests-helpers.ts` seeds a running entry. `timer-resolution.spec.ts` also covers snapped split halves and a split across the Lord Howe clock change; `history-calendar-resolution.spec.ts` drags calendar blocks at resolutions 5, 12 and 20 and moves an off-grid entry onto the grid.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../../api-and-data/time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../../api-and-data/time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../../api-and-data/time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [practice-ui-time-math-uses-wall-clock-helpers](practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [map-admin-user-management-api-and-the-last-active-admin-rule](../../api-and-data/users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md)
- Related: [map-invites-and-password-reset-links-in-account-tokens](../../api-and-data/users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
- Related: [map-instance-settings-api-app-admin-settings-and-setting-rules](../../api-and-data/users-and-admin/map-instance-settings-api-app-admin-settings-and-setting-rules.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../.redirects.json)
<!-- kk:citations:end -->
