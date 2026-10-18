# Parser fixtures

Shared test cases for the pure functions that other Tokkl clients port. The TypeScript tests in
`packages/common` (`duration.test.ts`, `timeOfDay.test.ts`, `snap.test.ts`) run every case in these
files, so a changed case fails here first. A client in another repository can read the same files to
check its port instead of copying cases by hand.

| File | Function | TypeScript source |
| --- | --- | --- |
| `duration.json` | `parseDuration` | `../duration.ts` |
| `timeOfDay.json` | `parseTimeOfDay` | `../timeOfDay.ts` |
| `snap.json` | `snapSpan` | `../snap.ts` |

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

## Error convention

- `expected: null` means the function rejects the input by returning no value. This is used by
  `duration.json` and `timeOfDay.json`. Map it to your platform's null, nil or optional-empty.
- `expected: { "throws": "RangeError" }` means the function raises an error of that kind. This is
  used by `snap.json`. The value names the JavaScript error class. Map `RangeError` to your
  platform's invalid-argument exception (for example `IllegalArgumentException` in Kotlin) and
  assert only on the kind, not on the message.

## Changing a case

Edit the JSON, run `npm test` in `packages/common`, and update every client that reads these files.
Keep case names unique. Do not remove a case without a reason, because other clients rely on it.
