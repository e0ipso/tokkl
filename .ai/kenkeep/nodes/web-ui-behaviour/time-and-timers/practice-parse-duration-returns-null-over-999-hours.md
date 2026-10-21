---
type: practice
title: 'Durations: over 999 hours is unreadable (null), not clamped'
description: >-
  MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as
  unreadable input.
tags:
  - time
  - parsing
  - validation
kk_schema_version: 3
kk_id: practice-parse-duration-returns-null-over-999-hours
kk_derived_from: []
kk_relates_to:
  - practice-twelve-hour-time-entry-parsing-rules
  - practice-web-previews-and-editor-show-snapped-durations
kk_depends_on: []
kk_confidence: high
---
`MAX_DURATION_SECONDS` (`999 * 3600`) is defined once in `packages/common/duration.ts`. The API imports it in `packages/api/src/models/timeEntries.ts` and does not keep its own copy; change the cap there only.

`parseDuration` returns `null` for any result over the cap on every branch: colon form, bare integer, bare decimal and unit list. Units are looked up in a `Map`, so prototype keys such as `constructor` are not units. A caller must treat `null` as unreadable input, never as empty or zero: the entry editor and the timer bar show "Check the duration" and the CSV import fails the row with "Invalid end time or duration".

The timer bar (`TimerBar.tsx`) treats only a Duration that is empty after trimming as "start a running timer". Any other text that `parseDuration` rejects is refused through `useFieldErrors` with "Check the duration" and no timer starts.

<!-- kk:related:start -->
# Related

- Related: [practice-twelve-hour-time-entry-parsing-rules](practice-twelve-hour-time-entry-parsing-rules.md)
- Related: [practice-web-previews-and-editor-show-snapped-durations](practice-web-previews-and-editor-show-snapped-durations.md)
<!-- kk:related:end -->
