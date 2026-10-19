# Parser and Pomodoro cycle fixtures

Shared test cases for the pure functions that other Tokkl clients port: the parsers, span snapping
and the Pomodoro cycle rules. The TypeScript tests in `packages/common` (`duration.test.ts`,
`timeOfDay.test.ts`, `snap.test.ts`, `pomodoro.test.ts`) run every case in these files, so a changed
case fails here first. A client in another repository can read the same files to check its port
instead of copying cases by hand. Tokkl for Android checks its port of the Pomodoro cycle against
`pomodoro.json`, so that file is a contract between the clients, not only a test of this package.

| File | Function | TypeScript source |
| --- | --- | --- |
| `duration.json` | `parseDuration` | `../duration.ts` |
| `timeOfDay.json` | `parseTimeOfDay` | `../timeOfDay.ts` |
| `snap.json` | `snapSpan` | `../snap.ts` |
| `pomodoro.json` | `workPhase`, `nextBreak`, `breakPhase`, `nextWorkPhase`, `nextCompletedCount` | `../pomodoro.ts` |

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
- `expected`: `{ "start", "stop" }` with the snapped instants, or an error object.

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

## Error convention

- `expected: null` means the function rejects the input by returning no value. This is used by
  `duration.json` and `timeOfDay.json`. Map it to your platform's null, nil or optional-empty.
- `expected: { "throws": "RangeError" }` means the function raises an error of that kind. This is
  used by `snap.json` and `pomodoro.json`. The value names the JavaScript error class. Map `RangeError` to your
  platform's invalid-argument exception (for example `IllegalArgumentException` in Kotlin) and
  assert only on the kind, not on the message.

## Changing a case

Edit the JSON, run `npm test` in `packages/common`, and update every client that reads these files.
Keep case names unique. Do not remove a case without a reason, because other clients rely on it.
