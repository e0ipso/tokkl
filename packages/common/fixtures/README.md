# Parser and Pomodoro fixtures

Shared test cases for the pure functions that other Tokkl clients port: the parsers, span snapping,
the Pomodoro cycle rules and the Pomodoro session rules. The TypeScript tests in `packages/common`
(`duration.test.ts`, `timeOfDay.test.ts`, `snap.test.ts`, `pomodoro.test.ts`,
`pomodoroSession.test.ts`) run every case in these files, so a changed case fails here first.

Other clients port from these files and the tests at a fixed tokkl commit. Tokkl for Android copies
cases by hand into its own tests and names the tokkl commit it copied from in each test file, so a
changed case reaches it only when it copies again from a newer commit.

| File | Function | TypeScript source |
| --- | --- | --- |
| `duration.json` | `parseDuration` | `../duration.ts` |
| `timeOfDay.json` | `parseTimeOfDay` | `../timeOfDay.ts` |
| `snap.json` | `snapSpan` | `../snap.ts` |
| `pomodoro.json` | `workPhase`, `nextBreak`, `breakPhase`, `nextWorkPhase`, `nextCompletedCount` | `../pomodoro.ts` |
| `pomodoroSession.json` | `startSession`, `plannedEnd`, `overtimeSeconds`, `transitionKind`, `nextPhase`, `pomodoroEntrySpan` | `../pomodoroSession.ts` |

## Case format

Each file is a JSON array of objects:

```json
{ "name": "…", "input": …, "options": { … }, "expected": … }
```

- `name`: a unique, human-readable label. Use it as the test name.
- `input`: the argument the function parses or snaps. Its shape is per file, see below.
- `options`: optional extra arguments. Absent means the function's defaults.
- `expected`: the result. See the error convention below.

Instants (in `input`, `options` and `expected`) are ISO 8601 strings in UTC with a `Z` suffix.
Parse them to instants before comparing; do not compare the text, because `input` omits
milliseconds and `expected` always writes three digits.

### `duration.json`

- `input`: a string, exactly as a person types it. It can be empty.
- `expected`: whole seconds, or `null` when the input is rejected.

### `timeOfDay.json`

- `input`: a string.
- `options`: `twelveHour` (boolean), `reference` (minutes after midnight, the start time a guess is
  made against) and `after` (minutes after midnight, the start that an end time must follow). All
  three are optional.
- `expected`: minutes after midnight, or `null` when the input is rejected.

### `snap.json`

- `input`: `{ "start", "stop", "minutes", "timeZone" }`. `start` and `stop` are ISO 8601 instants,
  `minutes` is the resolution and `timeZone` is an IANA name that defines the clock grid.
- `expected`: `{ "start", "stop" }` with the snapped instants, `null` for a span too short to keep
  (it lasted less than half a step, or both ends snap to the same point), or an error object.

### `pomodoro.json`

Every case calls one function, named by `input.function`. The other `input` fields are that
function's arguments:

| `function` | Other `input` fields | `expected` |
| --- | --- | --- |
| `workPhase` | `workSeconds`, `running`, `now` | `{ "remainingSeconds", "ended", "endsAt" }` |
| `nextBreak` | `completed` | `{ "kind", "seconds" }` |
| `breakPhase` | `kind`, `startedAt`, `now` | `{ "remainingSeconds", "ended", "endsAt" }` |
| `nextWorkPhase` | `kind`, `startedAt`, `running`, `now` | `{ "start", "workSeconds" }` or `null` |
| `nextCompletedCount` | `completed`, `event` | the new count |

- `workSeconds` is the running time accrued in the current work phase. Paused time and earlier
  phases are not in it, so a pause freezes it and a resume continues from the same value.
- `running` says whether a timer is running. `now`, `startedAt` (when the break started) and the
  event's `lastActiveAt` are instants.
- `completed` is the number of completed work phases before the current one ends.
- `kind` is `"short"` or `"long"`.
- `event` is `{ "type": "workEnded" }` for a work phase that ran its full length,
  `{ "type": "workStopped" }` for one abandoned by Stop, `{ "type": "breakEnded", "kind" }`, or
  `{ "type": "idle", "lastActiveAt", "now" }`. `lastActiveAt` is the last instant the device had a
  running timer or a break.
- `options`: the cycle settings `workMinutes`, `shortBreakMinutes`, `longBreakMinutes` and
  `longBreakEvery`. Each is optional; an absent one takes its default of 25, 5, 15 and 4. The
  lengths are whole minutes and every value is at least 1.
- `expected`: `remainingSeconds` never goes below zero, and `ended` is true once the elapsed time
  equals the length. `endsAt` in `workPhase` is `null` while the timer is paused. `seconds` and
  `workSeconds` are seconds. `null` from `nextWorkPhase` means no work phase starts: the break has
  not ended or no timer runs.

The rules the cases pin: the work phase that brings the count up to `longBreakEvery`, or past it
after the setting was lowered, is followed by a long break. The count goes back to zero when a long
break ends, and after the device has been idle for longer than the long-break length. A work phase
abandoned by Stop leaves the count unchanged. A break that ends while the timer runs hands over to a
work phase that starts at the break's end.

### `pomodoroSession.json`

Every case calls one function, named by `input.function`. The other `input` fields are that
function's arguments:

| `function` | Other `input` fields | `expected` |
| --- | --- | --- |
| `startSession` | `at` | a phase |
| `plannedEnd` | `phase` | an instant |
| `overtimeSeconds` | `phase`, `at` | seconds |
| `transitionKind` | `phase` | a transition kind |
| `nextPhase` | `phase`, `at` | `{ "next", "transition", "skipped" }` |
| `pomodoroEntrySpan` | `start`, `end`, `minutes`, `timeZone` | `{ "start", "stop" }` or `null` |

- A phase is `{ "kind", "startedAt", "completed" }`. `kind` is `"work"`, `"shortRest"` or
  `"longRest"`. `startedAt` is an instant. `completed` counts the work phases ended since the
  session started or the last long rest ended: a work phase counts the ones before it, a rest
  counts the work phase it follows.
- `at` is the instant the user starts the session, looks at the phase or confirms Next phase.
- A transition kind is `"workToShortRest"`, `"shortRestToWork"`, `"workToLongRest"` or
  `"longRestToWork"`.
- `start` and `end` are the instants a pomodoro started and ended, `minutes` is the resolution and
  `timeZone` is an IANA name that defines the clock grid, as in `snap.json`.
- `options`: the session config `workMinutes`, `shortRestMinutes`, `longRestMinutes` and
  `longRestEvery`. Each is optional; an absent one takes its default of 25, 5, 15 and 4. Every value
  is a whole number in its range: 1 to 180, 1 to 60, 1 to 60 and 1 to 12.
- `expected`: `next` in `nextPhase` is the phase that starts at `at`, and `skipped` is true when
  `at` is before the planned end. Overtime is zero up to the planned end. `null` from
  `pomodoroEntrySpan` means the span is too short to keep, as in `snap.json`.

The rules the cases pin: a phase changes only when the user confirms, and the next phase starts at
the confirm instant. Confirming before the planned end is a skip; after it, the phase has run
overtime. Every ended work phase counts toward `longRestEvery`, skipped ones too. The work phase
that brings the count up to `longRestEvery`, or past it after the setting was lowered, is followed
by a long rest, and the count goes back to zero when the long rest ends. A pomodoro is a work phase
plus the rest after it, and its entry runs from the work start to the next confirmed work start, or
to the instant the session ends. Each end snaps to the nearest grid point, the later one on a tie,
so the entries of two pomodoros in a row share a boundary.

## Error convention

- `expected: null` means the function rejects the input by returning no value. This is used by
  `duration.json` and `timeOfDay.json`. Map it to your platform's null, nil or optional-empty.
- `expected: { "throws": "RangeError" }` means the function raises an error of that kind. This is
  used by `snap.json`, `pomodoro.json` and `pomodoroSession.json`. The value names the JavaScript error class. Map `RangeError` to your
  platform's invalid-argument exception (for example `IllegalArgumentException` in Kotlin) and
  assert only on the kind, not on the message.

## Changing a case

Edit the JSON, run `npm test` in `packages/common`, and update every client that ports these files.
Keep case names unique. Do not remove a case without a reason, because other clients rely on it.
