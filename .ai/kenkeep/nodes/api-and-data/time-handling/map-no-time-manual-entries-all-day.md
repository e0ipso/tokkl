---
type: map
title: No-time manual entries (all_day)
description: >-
  Entries with all_day log a duration on a day: stored from local midnight,
  never running, re-anchored on a timezone change.
tags:
  - time-entries
  - api
  - web
  - timezones
kk_schema_version: 3
kk_id: map-no-time-manual-entries-all-day
kk_derived_from:
  - '7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:0'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:10'
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - practice-time-zone-names-are-stored-in-canonical-form
  - practice-json-restore-rules
  - >-
    practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top
kk_depends_on: []
kk_confidence: high
---
A no-time entry records a duration on a day with no start or end time. `time_entries.all_day` (an `INTEGER` column, `all_day: boolean` in `packages/types`) marks it. Writes send `all_day: true`, `start_date` (the local day) and `duration`.

- **Storage:** `noTimeSpan` in `packages/api/src/domain/timeEntries.ts` stores it from local midnight of the day in the owner's timezone to midnight plus the duration. Live writes snap the duration to the instance time resolution; CSV import and JSON restore pass `exact` and keep it as in the file. A zero (after snapping) or negative duration and anything over 24 hours are refused, and a no-time entry can never be running. No-time entries skip `settleSpan`, so they never trim or get trimmed by timed entries.
- **Edits:** once an entry has no times, a PATCH to `/start` or `/stop` is rejected; turning `all_day` off needs a start and a stop. An edit that keeps the day and duration keeps the stored span, so an off-grid imported entry can still be renamed.
- **Timezone change:** `reanchorNoTimeEntries`, called from `PUT /me` in `routes/togglV9.ts`, moves every no-time entry of the user, trashed ones too, to midnight of the same local day in the new zone and keeps each duration.
- **Export and import:** the CSV exports leave start and end times blank for these rows; CSV import and JSON restore recognise them and recreate them as no-time entries.
- **Web:** the manual form in `TimerBar.tsx` and `EntryEditor.tsx` have a "No times" switch (`lib/noTimeEdit.ts` builds the update body). `EntryList` shows a duration only and never marks them as overlapping. `WeekCalendar` draws them as chips in a row above the hour grid (`splitAllDay`).

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [practice-time-zone-names-are-stored-in-canonical-form](practice-time-zone-names-are-stored-in-canonical-form.md)
- Related: [practice-json-restore-rules](../toggl-compat-and-import/practice-json-restore-rules.md)
- Related: [practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:0
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:10
<!-- kk:citations:end -->
