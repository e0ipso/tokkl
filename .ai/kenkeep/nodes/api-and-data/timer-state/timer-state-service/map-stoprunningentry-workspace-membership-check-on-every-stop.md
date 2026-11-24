---
type: map
title: 'stopRunningEntry: workspace membership check on every stop'
description: >-
  Every path that stops the running entry goes through stopRunningEntry, which
  checks workspace membership first.
tags:
  - api
  - timer
kk_schema_version: 3
kk_id: map-stoprunningentry-workspace-membership-check-on-every-stop
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - map-timer-start-stop-and-edit-routes
  - map-timer-and-pomodoro-actions-revision-checks-and-optional-revision
kk_depends_on: []
kk_confidence: high
---
Every path that stops the running entry goes through `stopRunningEntry` in `domain/timeEntries.ts`, which checks membership of the entry's workspace (`memberWorkspace`) before `stopEntryAt`: the stop action, pause, End session, Next phase from rest to work, and the implicit stop when a timer, a session or a running v9 entry starts or an edit makes an entry run. A user who left that workspace gets the v9 403 and the whole transaction rolls back. Resume refuses through `createTimeEntry`; discard touches no entry and still works.

<!-- kk:related:start -->
# Related

- Related: [map-timer-start-stop-and-edit-routes](map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
