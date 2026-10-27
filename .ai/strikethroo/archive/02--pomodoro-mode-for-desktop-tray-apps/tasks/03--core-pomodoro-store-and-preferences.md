---
id: 3
group: "core-pomodoro"
dependencies: [1]
status: "completed"
created: 2026-10-26
skills:
  - cpp-qt
  - rest-api
complexity_score: 5
execution_profile: "standard-implementation"
---
# Pomodoro store interface, session records and preferences client

## Objective
Add three things to `desktop/core`: a store interface for the Pomodoro data each device keeps, with a QSettings implementation; the session and unsaved-pomodoro records with validated JSON serialisation; and a preferences client that reads and writes the four `pomodoro_*` preferences and caches them.

## Skills Required
C++20 with Qt 6 Core for the store and records, and REST client work on the existing `Connection` (Qt Network) for `GET` and `POST /api/v9/me/preferences`.

## Acceptance Criteria
- [ ] `desktop/core/src` has a `PomodoroStore` interface (next to `ChainStore`, same shape: a `QObject` with pure virtual methods) that loads and saves the per-device mode (Timer or Pomodoro) and, per owner (instance, account and workspace, like `TimerController::chainOwner()`), one record: the cached `PomodoroConfig`, the session or none, and the unsaved pomodoros.
- [ ] `SettingsPomodoroStore` implements it on a QSettings group, like `SettingsChainStore`. A save calls `sync()` and returns false when `QSettings::status()` is not `NoError`. A save that returned true is on disk.
- [ ] The session record holds: id, revision, config, project id (optional), billable, phase (kind, startedAt, completed), pomodoroStart and ending. The unsaved item holds: id, owner, workspace id, start, stop, duration, project id, billable, attempts and retryAt. Both serialise to versioned JSON (`version: 1`). Parsing follows `parsePomodoroSession` and `parseUnsavedPomodoros` in `packages/web/src/components/pomodoroSessionState.ts`: a broken or future record is no session, and a broken queue item is skipped without dropping the others.
- [ ] `Connection` gains `fetchPreferences` (`GET /api/v9/me/preferences`) and `savePreferences` (`POST /api/v9/me/preferences` with only the given keys). Both decode the four keys `pomodoro_focus_interval_in_minutes`, `pomodoro_break_interval_in_minutes`, `pomodoro_long_break_interval_in_minutes` and `pomodoro_long_break_every` into a `PomodoroConfig`. A missing or out-of-range value falls back to its default, one key at a time.
- [ ] A `PomodoroPreferences` QObject exposes the four values, an `editable` flag (true only with a validated account), `saving`, one error string per field and a general error string. Its `save(work, shortRest, longRest, longRestEvery)` posts only the keys that changed. It reads the preferences each time the connection becomes Connected and when its `refresh()` slot runs, caches every value it reads or saves in the store for the owner, and, with no connection, shows the cached values with `editable` false. `refresh()` also accepts a completion callback (or emits a `refreshed(bool ok)` signal) so the session controller can wait for a read before it starts a session.
- [ ] A 400 whose message names one of the four keys (the server sends `Invalid <key>: expected an integer from <min> to <max>`) sets that field's error to the message. Other errors set the general error.
- [ ] A reply from an earlier connection generation changes nothing.
- [ ] New CTest tests cover the store round trip on a temporary QSettings file (including a corrupt record and one corrupt queue item next to a good one) and the preferences client against the scripted transport in `desktop/core/autotests/fakes.h`: fallback per key, offline cached values, the body of a save holding only the changed keys, the 400 field mapping, and a generation change. `desktop/core/ci/check.sh` exits 0 with the new tests passed.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Server contract: `packages/api/src/routes/togglV9.ts` (lines around 210–224) merges the posted keys into the stored preferences, and `packages/api/src/models/users.ts` (`PREFERENCE_RULES`, `validatePreferenceChanges`) validates them. Only the four keys may ever be posted, so other clients' keys stay as they are.
- Follow `Connection`'s existing typed operations (`fetchMe`, `fetchProjects`) and its private `call<T>` helper. Do not add a second HTTP path.
- The store does not decide policy. Session rules belong to task 5 and queue rules to task 4.
- Qt Core and Network only; no Qt Gui.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 1: `PomodoroConfig`, its ranges and defaults, and `SessionPhase`.

## Output Artifacts
- `PomodoroStore`, `SettingsPomodoroStore` and the record types, used by the save queue (task 4), the session controller (task 5), the KDE store (task 6), tokkl-timerd (task 9) and the macOS app (task 13).
- `PomodoroPreferences`, used by the session controller and by every settings pane (tasks 8, 9, 14).

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `desktop/core/src/chainstore.h/.cpp` and copy its structure for `PomodoroStore` and `SettingsPomodoroStore`. Suggested API:
   - `virtual bool loadPomodoroMode() = 0;` and `virtual bool savePomodoroMode(bool) = 0;`
   - `virtual QByteArray loadRecord(const QString &owner) = 0;` and `virtual bool saveRecord(const QString &owner, const QByteArray &json) = 0;` (an empty array removes it).

   Keeping the record as JSON text means the KDE store only stores a string, and all validation stays in core.
2. Put the record types and their `toJson()` and `fromJson()` in core next to the store, for example `pomodororecord.h/.cpp`. Port the checks from `pomodoroSessionState.ts`:
   - `pomodoroStart <= phase.startedAt`, and they are equal for a work phase.
   - The config passes the range check.
   - Queue items have unique non-empty ids, `attempts >= 0`, `retryAt >= 0`, `stop > start` and `duration == (stop - start) / 1000`.
   - Instants are stored as milliseconds since the epoch, or as ISO strings with milliseconds; pick one and use it everywhere.
   - The description is always empty and there are no tags or task, so do not store them.
3. Add a `decodePomodoroPreferences(QJsonValue)` to `apitypes.h/.cpp` that returns a `PomodoroConfig` from an object, taking the default for each key that is missing, non-integer or out of range. A body that is not an object is an invalid response.
4. Add `Connection::fetchPreferences(Callback<PomodoroConfig>)` and `Connection::savePreferences(const QJsonObject &changes, Callback<PomodoroConfig>)` with `Access::Read` and `Access::Write`. The POST body is the `changes` object.
5. Write `PomodoroPreferences` (for example `pomodoropreferences.h/.cpp`).
   - Constructor takes `Connection*` and `PomodoroStore*` (not owned; null store means memory only).
   - Track `Connection::stateChanged` and `generationChanged`. On a new generation, clear errors and load the cached record for the new owner. On reaching Connected, fetch.
   - Map the error message to a field by searching for each key name in `ApiError::message`.
   - Emit one `changed()` signal for values and one for state, as `TimerController` groups its signals.
6. Tests: add `pomodorostoretest.cpp` and `pomodoropreferencestest.cpp` to `desktop/core/autotests/CMakeLists.txt` and to the XDG `set_tests_properties` list. Use `QTemporaryDir` for the QSettings file. For the client, script `/me` first (see how `timercontrollertest.cpp` brings a connection up with the fakes), then the preferences replies, and assert on the request bodies the fake transport recorded.
7. Run `desktop/core/ci/check.sh`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into one test function each for the store and the client.
</details>
