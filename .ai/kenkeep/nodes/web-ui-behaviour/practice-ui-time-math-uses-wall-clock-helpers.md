---
type: practice
title: UI time math uses account-local wall-clock helpers
description: >-
  Calendar positions and day/clock shifts use packages/common/time.ts helpers, never
  +86400000 ms or minutes*60000, so DST days work.
tags:
  - web
  - time
  - dst
  - calendar
  - common
kk_schema_version: 3
kk_id: practice-ui-time-math-uses-wall-clock-helpers
kk_derived_from: []
kk_relates_to:
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
Anything the UI positions or shifts on the calendar works on the account time zone's wall clock, not on elapsed milliseconds. Use the helpers in `packages/common/time.ts`: `clockMinutes` (minutes after local midnight), `clockSpanOnDay` (an entry's top/bottom on one day), `addClockMinutes` (move by clock minutes), and `addDays` on date keys. Combine a date key with minutes through `instantAt` in `packages/web/src/lib/entryTime.ts`. Adding `86400000` ms for a day or `minutes * 60000` for a clock shift breaks on the 23- and 25-hour DST days.

Settled DST decisions, covered by `packages/common/time.test.ts` and the e2e DST cases:
- A time that falls in the spring gap resolves to just after the gap.
- A time in the repeated autumn hour resolves to the later occurrence.
- Dragging an entry on the week calendar moves its start by clock minutes and keeps its elapsed duration; resizing moves the stop by clock minutes. The dropped boundary then goes through `snappedInstant`, and resizing an entry whose start is off the grid also sends the snapped start (see `practice-web-previews-and-editor-show-snapped-durations`).

<!-- kk:related:start -->
# Related

- Related: [practice-web-previews-and-editor-show-snapped-durations](practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->
