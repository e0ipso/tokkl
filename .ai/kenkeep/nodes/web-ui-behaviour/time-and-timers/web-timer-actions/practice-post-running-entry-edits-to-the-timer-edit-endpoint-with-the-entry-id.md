---
type: practice
title: Post running-entry edits to the timer edit endpoint with the entry id
description: >-
  Running-entry edits post to /api/app/timer/edit with entry_id and no revision;
  a 409 is adopted and fails the edit as a conflict.
tags:
  - web
  - timer
kk_schema_version: 3
kk_id: practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id
kk_derived_from: []
kk_relates_to:
  - map-accepttimerstate-one-validated-entry-for-every-web-timer-state
  - practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer
  - >-
    practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome
kk_depends_on: []
kk_confidence: high
---
Edits of the running entry from the timer bar, the Pomodoro page, the entry editor and a calendar move of the running block (`useUpdateRunningEntry` and `updateRunningEntry` in `api/entries.ts`) post to `POST /api/app/timer/edit` through `editRunningEntry` (`api/timerHooks.ts`) with `entry_id`, the entry the user edited, and no revision (`timer-edit-entry`). The reply is a timer state that goes through `acceptTimerState`. They can change the description, project, task, billable and tags, and the entry editor and the calendar also send a moved `start` (`RunningEntryChanges`); tags sent replace the entry's tags and a null project or task clears it. They keep the entry's mutation scope (`entryScope`), so they stay in order with other edits of that entry. They carry `MOVES_TIMER` but do not call `settleOtherWrites`, which would wait for the edit itself. The server refuses only once that entry no longer runs, so a change that moved the revision without stopping it, such as another device tagging it, does not refuse the edit, and there is no resend loop. A 409 with a state is adopted and the edit fails with the `conflict` error; it is never applied to another entry. A request with no reply keeps its own error (not the `offline` one), as a stopped-entry edit does, and marks the timer unknown like any timer write. Edits of stopped entries stay on the v9 PUT (`updateEntry`).

<!-- kk:related:start -->
# Related

- Related: [map-accepttimerstate-one-validated-entry-for-every-web-timer-state](../../pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md)
- Related: [practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer](practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md)
- Related: [practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md)
<!-- kk:related:end -->
