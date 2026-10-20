---
type: map
title: Pomodoro cycle functions in packages/common/pomodoro.ts
description: >-
  Clock-free workPhase, nextBreak, breakPhase, nextWorkPhase and
  nextCompletedCount; pomodoro.json is their cross-client contract.
tags:
  - common
  - pomodoro
  - timer
  - fixtures
kk_schema_version: 3
kk_id: map-pomodoro-cycle-functions-in-packages-common
kk_derived_from: []
kk_relates_to:
  - practice-preferences-validated-by-known-key
  - practice-parser-cases-live-in-shared-json-fixtures
  - map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
  - map-pomodoro-session-model-in-packages-common-pomodorosession
kk_depends_on: []
kk_confidence: high
---
`packages/common/pomodoro.ts`, exported as `@tokkl/common/pomodoro` (`./pomodoro` in the package's `exports`), holds the Pomodoro cycle rules: `workPhase`, `nextBreak`, `breakPhase`, `nextWorkPhase` and `nextCompletedCount`, which takes a `CycleEvent` (`workEnded`, `workStopped`, `breakEnded` with its kind, `idle` with `lastActiveAt` and `now`). The functions read no clock and keep no state; the caller passes lengths, counts and instants. They take a `PomodoroSettings` (`workMinutes`, `shortBreakMinutes`, `longBreakMinutes`, `longBreakEvery`), not the stored `pomodoro_*` preference keys, so a caller maps the preferences onto it. Bad input throws `RangeError`. The web app's driver over these functions is `map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider`. The confirm-driven session model that sits beside this cycle is `map-pomodoro-session-model-in-packages-common-pomodorosession`.

`packages/common/fixtures/pomodoro.json` is the contract for these functions. Tokkl for Android does not read it. It copies cases by hand at a tokkl commit named in its test file, so a changed case reaches it only when it copies again. Change a rule in the JSON first (see `practice-parser-cases-live-in-shared-json-fixtures`); `packages/common/fixtures/README.md` documents each function's `input` fields.

Settled rules:

- Work time is the running time accrued in the current work phase. A pause freezes it and a resume continues from the same value. A break runs on elapsed time from its start, whether or not a timer runs. Reaching the length exactly counts as ended.
- `nextBreak(completed)` takes the count of work phases completed before the one that is ending. The break is long when `completed + 1 >= longBreakEvery`, so a count above a lowered setting still gets a long break.
- `nextCompletedCount`: a finished work phase adds one, a stopped one leaves the count, a long break's end resets it to 0. Idle longer than the long-break length resets it; idle for exactly that length keeps it.
- `nextWorkPhase` returns null while the break has not ended or when no timer runs. Otherwise the next work phase starts at the break's end and its work time counts from there.

<!-- kk:related:start -->
# Related

- Related: [practice-preferences-validated-by-known-key](../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md)
- Related: [practice-parser-cases-live-in-shared-json-fixtures](../tooling-and-project/testing/practice-parser-cases-live-in-shared-json-fixtures.md)
- Related: [map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
<!-- kk:related:end -->
