---
type: practice
title: Claim Pomodoro session saves durably under the account Web Lock
description: >-
  Session saves and timer handoffs hold the account Web Lock; ended pomodoros
  wait in a durable queue that reconciles before retrying.
tags:
  - web
  - pomodoro
  - localstorage
kk_schema_version: 3
kk_id: practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:0'
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:0'
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - practice-end-sessions-through-lib-session
kk_depends_on: []
kk_confidence: high
---
Use `withPomodoroSessionLock` in `packages/web/src/components/pomodoroSessionLock.ts` for Pomodoro session mutations and saves. It requests the exclusive `tokkl.pomodoroSession.<accountId>` Web Lock and holds it until the save settles. Missing `navigator.locks` rejects the operation with a message requiring HTTPS or localhost; there is no unlocked fallback. `withTimerOperationLock` takes the same lock for regular timer starts and pauses, and runs unlocked only when there is no session and `navigator.locks` is missing, so plain timers still work over HTTP.

The controller re-reads state under the lock. A transition to work publishes the next phase and increments `revision` as the save claim before creating the stopped entry; End first persists `ending: true` and leaves that claim until the save settles. These claims stop another tab or a reload from posting the same pomodoro twice.

`createPomodoroSessionStorage` in `pomodoroSessionState.ts` refuses a shared save if its claim cannot be stored, with `Free some browser storage before saving this Pomodoro session.` A session started entirely in memory can still save when storage is blocked because no other tab can replay it. Refused local state survives only while the stored text is unchanged; a foreign durable write wins.

An ended pomodoro's span and fields never change after it ends. The phase change and the queued item go into the stored record in one write before any POST, so a crash or failed request leaves the item in the `unsaved` queue. Retries run under the same lock. A create whose response was lost may still have landed, so once an item has been attempted, `hasSavedPomodoro` in `pomodoroSessionRetry.ts` first queries `/api/v9/me/time_entries` for that exact start and stop, bypassing the cached list, and posts only when nothing matches; a failed lookup keeps the item. The delay starts at 5 s and doubles up to 5 minutes, and `watchPomodoroRetries` also wakes on window `focus` and `online`. Only a 4xx other than 401, 408 and 429 (`irrecoverablePomodoroError`) drops the item, showing the server message; those three, network errors and 5xx stay queued.

Explicit sign-out calls `end(true)`. It makes one final save attempt for the active session, then clears the stored session and the whole queue, without waiting for older failures to drain. Nothing from that queue is replayed later.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [practice-end-sessions-through-lib-session](practice-end-sessions-through-lib-session.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:0
[2] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:0
<!-- kk:citations:end -->
