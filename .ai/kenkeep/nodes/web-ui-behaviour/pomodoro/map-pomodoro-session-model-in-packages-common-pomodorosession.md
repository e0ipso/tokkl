---
type: map
title: Pomodoro session model in packages/common/pomodoroSession.ts
description: >-
  Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and
  nextPhase, run by the server.
tags:
  - common
  - pomodoro
  - timer
  - fixtures
kk_schema_version: 3
kk_id: map-pomodoro-session-model-in-packages-common-pomodorosession
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:1'
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:2'
  - 'bff2d85c-6ffd-4b0a-8c4b-78f0be7d1099:map:1'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:5'
kk_relates_to:
  - map-pomodoro-cycle-functions-in-packages-common
  - practice-parser-cases-live-in-shared-json-fixtures
  - practice-preferences-validated-by-known-key
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
kk_depends_on: []
kk_confidence: high
---
`packages/common/pomodoroSession.ts`, exported as `@tokkl/common/pomodoroSession`, models a Pomodoro session in which a phase changes only when the user confirms the next phase. It is the only Pomodoro module in `@tokkl/common`. The API's timer state service (`packages/api/src/domain/timers.ts`) runs the session with these functions and keeps the session; clients read the resulting state and apply no phase rule of their own (see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). It reads no clock, keeps no state and knows nothing about stored preferences. The caller passes every instant.

Exports: `DEFAULT_POMODORO_SESSION_CONFIG` (25, 5, 15 minutes, long rest every 4) and `POMODORO_SESSION_CONFIG_RANGES` (work 1-180, short and long rest 1-60, long-rest-every 1-12). `packages/api/src/domain/accountValues.ts` imports both constants to derive the `pomodoro_focus_interval_in_minutes`, `pomodoro_break_interval_in_minutes`, `pomodoro_long_break_interval_in_minutes` and `pomodoro_long_break_every` defaults and validation rules. `PreferencesSection.tsx` uses the common defaults, and `PomodoroPage.tsx` uses both defaults and ranges. Change the shared declarations in common; literal test expectations pin the defaults and ranges independently. Functions: `startSession`, `plannedEnd`, `transitionKind` and `nextPhase` (returns `{ next, transition, skipped }`). Clients compute overtime by subtracting the current time from the state's `planned_end`. Phase kinds are `work`, `shortRest` and `longRest`; transitions are `workToShortRest`, `shortRestToWork`, `workToLongRest` and `longRestToWork`.

Settled rules:

- Confirming before the planned end is a skip (`skipped: true`); confirming after it means the phase ran overtime.
- Every ended work phase counts toward the long rest, skipped or not. A phase carries `completed`: a work phase counts the ones before it, a rest counts the work phase it follows. The rest is long when `completed + 1 >= longRestEvery`, and the count restarts at 0 after a long rest.
- Confirming before the phase start, a config value out of range or a malformed phase throws `RangeError`.
- A pomodoro's time entry runs from its work start to the next confirmed work start or the session end. The server stops it with the normal timer-stop snapping and starts the next one at the exact confirm instant.

`packages/common/fixtures/pomodoroSession.json` is the cross-client contract, run by `pomodoroSession.test.ts`; each case names its function in `input.function`, and `fixtures/README.md` documents the fields.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-cycle-functions-in-packages-common](map-pomodoro-cycle-functions-in-packages-common.md)
- Related: [practice-parser-cases-live-in-shared-json-fixtures](../../tooling-and-project/testing/practice-parser-cases-live-in-shared-json-fixtures.md)
- Related: [practice-preferences-validated-by-known-key](../../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../../api-and-data/time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../../api-and-data/time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../../api-and-data/time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:1
[2] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:2
[3] bff2d85c-6ffd-4b0a-8c4b-78f0be7d1099:map:1
[4] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:5
<!-- kk:citations:end -->
