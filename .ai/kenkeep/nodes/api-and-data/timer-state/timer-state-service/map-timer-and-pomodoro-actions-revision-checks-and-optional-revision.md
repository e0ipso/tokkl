---
type: map
title: 'Timer and Pomodoro actions: revision checks and optional revision'
description: >-
  Timer actions build one reply at commit; stale revisions get a 409
  StateConflict; OPTIONAL_REVISION_ACTIONS lists the exceptions.
tags:
  - api
  - timer
  - pomodoro
  - pause
kk_schema_version: 3
kk_id: map-timer-and-pomodoro-actions-revision-checks-and-optional-revision
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - map-timer-settlement-and-revision-fingerprint
  - map-pomodoro-session-model-in-packages-common-pomodorosession
kk_depends_on: []
kk_confidence: high
---
Actions run in one transaction on the settled state. The action builds its reply once, in `ctx.readAtCommit`: the runner calls it after every before-commit hook has run, settlements and hooks a wrapping transaction added included, so the reply is the state the transaction commits. Nothing changes the reply after that. `resume`, `discard`, `next` and `end` take `{revision}`, and a stale one gets a 409 whose body is the current state (`StateConflict`), as does any action the state refuses, such as pausing during a session. `POST /api/app/timer/pause` (`pause-revision`) and `POST /api/app/pomodoro` (`pomodoro-revision`) take an optional `revision`: when sent it is checked like any other, and a body without it (pause also takes no body at all) acts on whatever runs, so older clients keep working. `OPTIONAL_REVISION_ACTIONS` in `commands/timers.ts` is the one list of these actions and defines the minimum client a release may require: one that sends the revision on every listed action. Do not add another optional-revision branch outside it. A later release will require the revision there too; until then `timerRoutes` logs each user agent that omits it, at info level (the default) and at most hourly per action (`Timer action without revision`), so operators can tell when that is safe. Clients should send it, because a session start stops a running timer. It is refused while a session runs, and it ends any chain. A start body may override the four lengths for that session. Next phase from a rest to work stops the open pomodoro's entry at the confirm instant and starts the next one at the same instant with the same fields, so edits to the running entry carry over.

<!-- kk:related:start -->
# Related

- Related: [map-timer-settlement-and-revision-fingerprint](map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
