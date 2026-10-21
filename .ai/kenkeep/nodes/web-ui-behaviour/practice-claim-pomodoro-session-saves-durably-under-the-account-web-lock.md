---
type: practice
title: Claim Pomodoro session saves durably under the account Web Lock
description: >-
  Shared session saves need an exclusive account Web Lock and a durable claim
  before POST; blocked claims refuse the save.
tags:
  - web
  - pomodoro
  - localstorage
kk_schema_version: 3
kk_id: practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:0'
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - practice-end-sessions-through-lib-session
kk_depends_on: []
kk_confidence: high
---
Use `withPomodoroSessionLock` in `packages/web/src/components/pomodoroSessionLock.ts` for Pomodoro session mutations and saves. It requests the exclusive `tokkl.pomodoroSession.<accountId>` Web Lock and holds it until the save settles. Missing `navigator.locks` rejects the operation with a message requiring HTTPS or localhost; there is no unlocked fallback.

The controller re-reads state under the lock. A transition to work publishes the next phase and increments `revision` as the save claim before creating the stopped entry; End first persists `ending: true` and leaves that claim until the save settles. A failed request is not replayed. These claims prevent another tab or reload from posting the same pomodoro again.

`createPomodoroSessionStorage` in `pomodoroSessionState.ts` refuses a shared save if its claim cannot be stored, with `Free some browser storage before saving this Pomodoro session.` A session started entirely in memory can still save when storage is blocked because no other tab can replay it. Refused local state survives only while the stored text is unchanged; a foreign durable write wins.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [practice-end-sessions-through-lib-session](practice-end-sessions-through-lib-session.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:practice:0
<!-- kk:citations:end -->
