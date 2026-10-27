---
id: 1
group: "core-pomodoro"
dependencies: []
status: "completed"
created: 2026-10-26
skills:
  - cpp-qt
  - qtest
complexity_score: 5
execution_profile: "standard-implementation"
---
# Port the Pomodoro cycle and snapping rules to desktop/core

## Objective
Add a stateless C++ port of `packages/common/pomodoroSession.ts` and `packages/common/snap.ts` to `desktop/core`, decode `time_resolution_minutes` in `Me`, and run every case of `packages/common/fixtures/pomodoroSession.json` and `packages/common/fixtures/snap.json` against the port.

## Skills Required
C++20 with Qt 6 Core (`QDateTime`, `QTimeZone`, `QJsonDocument`) for the port, and Qt Test for the data-driven fixture test.

## Acceptance Criteria
- [x] `desktop/core/src` has a cycle header and source (for example `pomodorocycle.h/.cpp`) and a snap header and source (for example `snap.h/.cpp`), listed in `desktop/core/src/CMakeLists.txt`. They link Qt Core only.
- [x] The cycle API has: `PomodoroConfig` (workMinutes, shortRestMinutes, longRestMinutes, longRestEvery) with defaults 25/5/15/4 and inclusive ranges 1–180, 1–60, 1–60, 1–12; `PhaseKind` (work, shortRest, longRest); `TransitionKind` (workToShortRest, shortRestToWork, workToLongRest, longRestToWork); `SessionPhase` (kind, startedAt, completed); `PhaseChange` (next, transition, skipped); and `startSession`, `plannedEnd`, `overtimeSeconds`, `transitionKind`, `nextPhase`, `pomodoroEntrySpan`. Each kind has a string name equal to the fixture spelling (`work`, `shortRest`, `workToShortRest`, …) with a parser for it.
- [x] The snap API has `isTimeResolution`, `snapInstant` and `snapSpan`, with the same results as `snap.ts`, including the DST and half-hour-offset cases.
- [x] Every input the TypeScript rejects with `RangeError` gives an error result in C++ (`std::nullopt` or an equivalent), never a crash or an exception across Qt code.
- [x] `Me` has `timeResolutionMinutes`. `decodeMe` reads `time_resolution_minutes` and uses 1 when it is missing or fails `isTimeResolution`. `Me::toVariantMap()` includes it. `desktop/core/autotests/apitest.cpp` covers present, missing and invalid values.
- [x] A new CTest test (for example `pomodorocycle`, source `desktop/core/autotests/pomodorocycletest.cpp`) reads both fixture files from the repository through a compile definition, runs each case as a QTest data row named after its `name`, fails when a file is missing or a case names an unknown `function`, and checks that the number of rows run equals the number of entries in each file.
- [x] `desktop/core/ci/check.sh` exits 0. Its CTest output lists the new test as passed, and the script still rejects a Qt Gui link.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read `packages/common/pomodoroSession.ts`, `packages/common/snap.ts` and `timeZoneOffsetMs` in `packages/common/time.ts` before writing code. Port the logic line by line; do not redesign it.
- Results in seconds can be fractional when instants carry milliseconds, so `overtimeSeconds` returns `double`.
- Time-zone offsets come from `QTimeZone(QByteArray ianaId).offsetFromUtc(QDateTime)`. An unknown zone id is an error result.
- The core must stay free of Qt Gui (`desktop/core/ci/check.sh` enforces it).
- Never put plan or ticket references in code, comments or test names. CI runs `npm run check:tracker-refs`.

## Input Dependencies
None.

## Output Artifacts
- The cycle and snap API in `desktop/core/src`, used by the store (task 3), the save queue (task 4), the session controller (task 5) and the sound catalogue (task 2, for `TransitionKind`).
- `Me::timeResolutionMinutes`, used when a pomodoro is snapped.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `desktop/core/src/chainstore.h`, `clock.h` and `apitypes.h` for the comment style. Comments state the rule, not the history.
2. Write the cycle port.
   - `startSession(at)` returns a work phase with `completed = 0` and `startedAt = at`. An invalid `QDateTime` is an error.
   - `plannedEnd(phase, config)` validates config and phase, then returns `startedAt + minutes * 60 s` for the phase kind.
   - `overtimeSeconds(phase, at, config)` is `max(0, (at - plannedEnd) / 1000.0)` in seconds.
   - `transitionKind`: work gives `workToLongRest` when `completed + 1 >= longRestEvery`, else `workToShortRest`. Short rest gives `shortRestToWork`, long rest gives `longRestToWork`.
   - `nextPhase(phase, at, config)`: error when `at < phase.startedAt`. `skipped = at < plannedEnd`. Work to short or long rest sets `completed + 1`. Long rest to work resets `completed` to 0. Short rest to work keeps `completed`.
   - `pomodoroEntrySpan(start, end, minutes, timeZone)` returns `snapSpan(...)`.
   - Validation mirrors `checkConfig` and `checkPhase`: every config value is an integer inside its range, and `completed` is an integer of 0 or more.
3. Write the snap port with the same structure as `snap.ts`: `gridFloor`, `nearestGridPoint` (the single-offset path and the multi-offset candidate path with the tie going to the later point), `snapInstant`, `snapSpan` (null when `elapsed * 2 < step` or when both ends snap to one point). Work in milliseconds since the epoch as `qint64`. `Math.floor` on negative numbers must floor, not truncate, so use an explicit floor division helper.
4. Add `timeResolutionMinutes` to `Me` in `apitypes.h/.cpp`. Keep the decoder tolerant: missing or invalid gives 1. The server snaps on write as well, so the client value mainly drives the too-short check and shared boundaries.
5. Fixture test.
   - In `desktop/core/autotests/CMakeLists.txt`, add the test with a definition such as `TOKKL_COMMON_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../../../packages/common/fixtures"`, and add it to the `set_tests_properties` XDG list.
   - Open each file and read the case shapes before writing the dispatcher. `pomodoroSession.json` cases have `input.function`, the arguments, an optional `options` object (the config) and `expected`, which is a value, an object, or `{"throws": "RangeError"}`. `snap.json` cases have `input.start/stop/minutes/timeZone` and `expected` (`{start, stop}` or `null`).
   - Parse instants with `QDateTime::fromString(text, Qt::ISODateWithMs)`. A string that does not parse is an invalid instant, which must give the error result.
   - Compare instants as `QDateTime` values, not strings. Compare seconds as `double` with an exact match unless a case needs tolerance; fixture values are exact.
   - Use `QTest::addColumn` with the case object and `QTest::newRow(name)`. Count rows and `QCOMPARE` the count with the array length in a separate test function.
6. `desktop/core/ci/check.sh` mounts the repository read-only at `/repo`, so the fixtures are readable. If a DST case fails because the container lacks zone data, add `tzdata` to the `dnf install` line in that script.
7. Run `desktop/core/ci/check.sh` and read the CTest summary. The new test must show as passed and its row count must match both fixture files.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. The fixture test is the contract with the web app; do not add per-function unit tests that repeat what the fixtures cover.
</details>
