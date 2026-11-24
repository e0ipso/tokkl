---
type: map
title: 'Timer start, stop and edit routes'
description: >-
  POST /api/app/timer/start, stop and edit take a revision or entry_id
  precondition and answer the committed TimerState.
tags:
  - api
  - timer
kk_schema_version: 3
kk_id: map-timer-start-stop-and-edit-routes
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - practice-creates-take-an-idempotency-key
  - map-timer-and-pomodoro-actions-revision-checks-and-optional-revision
  - map-stoprunningentry-workspace-membership-check-on-every-stop
kk_depends_on: []
kk_confidence: high
---
`POST /api/app/timer/start` and `POST /api/app/timer/stop` take `{revision}` like the other timer actions and answer the committed `TimerState`. Start takes the v9 entry fields, an optional `workspace_id` and an optional `start`, and runs `createTimeEntry`, so a running timer stops at the new start and its session or chain ends in settlement. Stop takes an optional `stop` and runs `stopEntryAt` on the running entry; with nothing running it gets the 409. `POST /api/app/timer/edit` takes a precondition, the label fields (`description`, `project_id`, `task_id`, `billable`, `tags`/`tag_ids`, tags replacing) and an optional `start`, and runs `updateTimeEntry` on the running entry with only that start as times, so it validates, refuses and checks membership exactly as a v9 PUT of that entry. The precondition is `revision`, `entry_id` (`timer-edit-entry`) or both, and each one sent must hold. `entry_id` refuses only once that entry no longer runs, so a change that moves the revision without touching the entry, such as renaming its project, does not send the web entry editor round a 409 loop; with nothing running, or another entry running, it gets the 409. Timer start and Pomodoro start take an `Idempotency-Key` header (see `practice-creates-take-an-idempotency-key`): a repeat changes nothing and answers the current state, before the revision check the first start moved on.

These routes give the web app and the desktop companions a timer reply for Start, Stop and edits; the v9 entry routes still do the same writes and answer the entry.

<!-- kk:related:start -->
# Related

- Related: [practice-creates-take-an-idempotency-key](../../toggl-compat-and-import/practice-creates-take-an-idempotency-key.md)
- Related: [map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-stoprunningentry-workspace-membership-check-on-every-stop](map-stoprunningentry-workspace-membership-check-on-every-stop.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
