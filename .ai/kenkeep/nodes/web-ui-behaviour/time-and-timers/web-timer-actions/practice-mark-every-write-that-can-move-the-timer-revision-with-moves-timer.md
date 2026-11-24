---
type: practice
title: Mark every write that can move the timer revision with MOVES_TIMER
description: >-
  currentRevision waits for writes marked MOVES_TIMER before a timer action;
  mark any write that changes the running entry, session or pause.
tags:
  - web
  - timer
  - pomodoro
kk_schema_version: 3
kk_id: practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer
kk_derived_from: []
kk_relates_to:
  - >-
    practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply
  - >-
    practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id
kk_depends_on: []
kk_confidence: high
---
An edit of the running entry, such as the description saved as the user clicks Next phase, moves the revision. `currentRevision` first waits for pending writes that can move the revision (`settleOtherWrites`) and reads the state again. `revisionToSend` then uses the fresh revision only if the session phase and the pause are the ones the user saw. Otherwise it sends the seen revision and lets the server answer with a conflict. Only mutations with `meta: MOVES_TIMER` (`api/timerState.ts`) count: every entry hook in `api/entries.ts`, and `useAction` calls passing `movesTimer: true` for edits of what the running entry shows (project, client, task and tag edits and deletes) and for imports. A new write that can change the running entry, its project, client, task or tags, or the session or pause must carry the mark. Preference, profile, password, workspace and admin saves carry none, so they never delay Resume or End session. Timer actions are unmarked, so an action never waits for itself. A marked write that TanStack holds for the connection (`isPaused`), such as an entry edit made offline, fails the wait at once with the `offline` error, so the action never goes out late after reconnect; an unmarked held write does not.

<!-- kk:related:start -->
# Related

- Related: [practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply](practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md)
- Related: [practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id](practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md)
<!-- kk:related:end -->
