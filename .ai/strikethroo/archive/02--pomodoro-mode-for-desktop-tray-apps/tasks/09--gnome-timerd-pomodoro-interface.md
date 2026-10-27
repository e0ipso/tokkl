---
id: 9
group: "gnome-pomodoro"
dependencies: [2, 3, 5]
status: "completed"
created: 2026-10-26
skills:
  - cpp-qt
  - dbus
complexity_score: 6
complexity_notes: "Grows a published D-Bus contract and its two copies (the XML and the extension's string). Backwards compatibility is not required, so it changes in place."
execution_profile: "complex-architecture"
---
# tokkl-timerd: Pomodoro on org.tokkl.Timer1

## Objective
Run the core Pomodoro session inside `tokkl-timerd` and publish it on `org.tokkl.Timer1`: the mode, the session state, the lengths and the per-transition sound choices as properties, and the actions as methods. Store the mode, the session and the sound choices in the service's own settings file.

## Skills Required
C++ with Qt 6 D-Bus (the generated adaptor, `PropertiesChanged`, error replies) on the shared core.

## Acceptance Criteria
- [x] `desktop/gnome/dbus/org.tokkl.Timer1.xml` gains properties, each documented in the file's comment style:
  - `PomodoroMode` (b), `ModeLocked` (b), `SessionActive` (b);
  - `Phase` (s: `""`, `work`, `shortRest`, `longRest`);
  - `PhaseStart` and `PlannedEnd` (x, Unix seconds, 0 without a session);
  - `PomodoroNumber` and `LongRestEvery` (i);
  - `NextPhase` (s), `Ringing` (b), `RingingTransition` (s), `SessionMessage` (s);
  - `PomodoroLengths` (a{si} with keys `work`, `shortRest`, `longRest`, `longRestEvery`), `PomodoroLengthsEditable` (b), `PomodoroLengthErrors` (a{ss});
  - `Sounds` (a{ss}, transition to sound id) and `SoundChoices` (aa{sv}: id and label from the catalogue).
- [x] It also gains methods:
  - `SetPomodoroMode(b) → accepted b`;
  - `Activate() → action s`, returning `handled`, `open-menu` or `ignored`;
  - `StartSession() → sent b`, `NextPhase() → sent b`, `EndSession() → sent b`;
  - `SetPomodoroLengths(i work, i shortRest, i longRest, i longRestEvery) → sent b`;
  - `RefreshPreferences()`;
  - `SetSound(s transition, s soundId) → accepted b`;
  - `PreviewSound(s soundId) → accepted b`.
- [x] `Start` returns false and sends nothing while Pomodoro mode is on and no timer runs.
- [x] `TimerService` maps every new property from `PomodoroSession`, `PomodoroPreferences` and the sound settings, and publishes changes through the existing `snapshot()`/`publishChanges()` path. Countdown seconds are not published every second, because the extension computes them from `PlannedEnd`. `Ringing` changes when the planned end passes.
- [x] The mode, the session records and the sound choices persist in the service's settings file (`SettingsPomodoroStore` on it, plus a `Sounds` group). A restart of the service keeps them.
- [x] `PreviewSound` and the ringing state are emitted as plain Qt signals on `TimerService` (for example `previewRequested(QString soundId)`, plus the existing property changes), which the player from task 10 connects to. Unknown sound ids or transitions are refused with `org.freedesktop.DBus.Error.InvalidArgs`.
- [x] `TIMER1_INTERFACE` in `desktop/gnome/extension/timer1.js` matches the new XML without comments, so `desktop/gnome/extension/tests/timer1.test.js` passes.
- [x] `desktop/gnome/autotests/timerservicetest.cpp` covers: each new property and its `PropertiesChanged`; the mode lock; `Activate` in each branch; `Start` refused in Pomodoro mode; a session through Next phase to a saved entry on the fake transport; `SetPomodoroLengths` with a 400 shown in `PomodoroLengthErrors`; `SetSound` persisting across a new service on the same settings file; and invalid arguments.
- [x] `desktop/gnome/ci/check.sh` exits 0, and `node --test desktop/gnome/extension/tests/` passes. Use the command the extension's CI uses if it differs.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read the kenkeep node `.ai/kenkeep/nodes/tooling-and-project/map-gnome-timerd-d-bus-timer-service.md` before changing the contract.
- The service adds no rule of its own: it maps core state and forwards calls (see the header comment of `desktop/gnome/src/timerservice.h`).
- `Configure` changes the connection, so the core's context-change signal from task 5 already ends the session and flushes the queue. Do not duplicate that in the service.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: the sound catalogue, for `SoundChoices`, the defaults and argument checks.
- Task 3: `SettingsPomodoroStore`, `PomodoroPreferences`.
- Task 5: `PomodoroSession`.

## Output Artifacts
- The new `org.tokkl.Timer1` contract, used by the extension (tasks 11, 12) and by tokkl-timerd playback (task 10).

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `desktop/gnome/src/timerservice.h/.cpp`, `desktop/gnome/dbus/CMakeLists.txt` (how the adaptor is generated) and `timerservicetest.cpp` with `privatebus.h`.
2. Add the XML first, then the `Q_PROPERTY` and slot declarations. The adaptor generator reads the XML; for `a{si}`, `a{ss}` and `aa{sv}`, add `org.qtproject.QtDBus.QtTypeName` annotations as the file does for `Projects`, and register the types with `qDBusRegisterMetaType` where needed.
3. Construct the store, the preferences, the queue and the session in the `TimerService` constructor next to the timer, all on the same settings file. Give the session the same clock as the timer.
4. Store the sound choices in a `Sounds` group of the same QSettings file, keyed by transition, defaulting to the catalogue.
5. Methods return quickly with the core's boolean result. `Activate` maps the enum to the strings above.
6. Update `TIMER1_INTERFACE` in `timer1.js` by copying the XML and removing comments. The test compares them member by member.
7. Tests: follow the existing private-bus pattern. Advance the fake clock past `PlannedEnd` to see `Ringing` change in `PropertiesChanged`.
8. Run `desktop/gnome/ci/check.sh` and the extension's node tests.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. The D-Bus contract is an integration point, so test it through the bus, not the C++ getters.
</details>
