---
id: 14
group: "macos-pomodoro"
dependencies: [2, 13]
status: "completed"
created: 2026-10-26
skills:
  - qt-widgets
  - macos-packaging
complexity_score: 6
complexity_notes: "Adds an audio dependency to the DMG and the CI macos job, which cannot be built locally; the settings section and the player are small."
execution_profile: "complex-architecture"
---
# macOS alarm player and Pomodoro settings section

## Objective
Play the alarm in the macOS app: loop the chosen sound while the session rings, and preview a sound from the settings. Add a Pomodoro section to `SettingsWindow` with the four shared lengths and the four sound choices. Bundle the sounds and any new library in the DMG.

## Skills Required
Qt 6 Widgets for the settings section and the player, and macOS packaging (CMake, `macdeployqt`, `desktop/macos/scripts/package-dmg.sh`, `check-dmg.sh`, the CI `macos` job).

## Acceptance Criteria
- [x] An `AlarmPlayer` interface in the portable library has a Qt Multimedia `QSoundEffect` implementation, or an AppKit `NSSound` one in a `.mm` shim if Qt Multimedia cannot be bundled. A fake is used in tests. `MenuBarApp` connects it to the session: loop the sound chosen for `ringingTransition` while `ringing` is true, and stop when it turns false.
- [x] The four sound choices are stored in `QSettings` under keys next to `SettingsWindow::monochromeIconKey`, defaulting to the catalogue's sound per transition.
- [x] `SettingsWindow` gains a "Pomodoro" section:
  - four `QSpinBox`es, "Work", "Short rest", "Long rest" (minutes) and "Long rest every" (pomodoros), with ranges 1–180, 1–60, 1–60 and 1–12, filled from `PomodoroPreferences`, which is refreshed when the window loads;
  - four `QComboBox`es, "Work → short rest", "Short rest → work", "Work → long rest" and "Long rest → work", with the catalogue labels, each with a "Preview" `QPushButton` that plays the selected sound once.
- [x] Save posts the changed lengths through `PomodoroPreferences::save()` and stores the sound choices. A server error appears in a label next to its field, and the window stays open. Without a validated account the spin boxes are read-only with the cached values, and a note says the lengths need a connection to the Tokkl server.
- [ ] The WAVs from `TOKKL_POMODORO_SOUND_FILES` end up in the app bundle's `Contents/Resources/sounds/` (or are compiled into the Qt resources), and the player finds them there. `desktop/macos/scripts/check-dmg.sh` checks for them. If Qt Multimedia is used, the `macos` job in `.github/workflows/ci.yml` installs the module (in both the CI and release jobs that build the DMG), and `package-dmg.sh` bundles its plugins. (NSSound was chosen, so CI and `package-dmg.sh` are unchanged. The CMake rule, the `.mm` shim and the `check-dmg.sh` check are written but only the CI `macos` job can run them; the Linux configure does prove `TOKKL_POMODORO_SOUND_FILES` reaches `src/` with four files.)
- [x] `desktop/macos/autotests/menubarapptest.cpp` covers:
  - the spin box ranges and the values loaded from the server;
  - Save posting only the changed keys;
  - a 400 shown next to its field;
  - the read-only state;
  - a sound choice stored and read back;
  - Preview calling the fake player;
  - the fake player looping on ringing and stopping on Next phase.
- [ ] The portable build and CTest pass on Linux (verified: 13/13). The CI `macos` job passes on the PR, including `check-dmg.sh` (only the CI job can prove this; not run here).

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read `.ai/kenkeep/nodes/tooling-and-project/map-macos-menu-bar-app.md` and `desktop/macos/README.md` first.
- If Qt Multimedia is chosen, the Linux CTest also needs it at build time; keep the player out of the test binary's real audio path by using the fake.
- Keep the connection settings' Save behaviour as it is: the secret still goes to the Keychain first. Saving the lengths must not block or reorder that.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: the sound catalogue and `TOKKL_POMODORO_SOUND_FILES`.
- Task 13: `MenuBarApp`'s session and preferences getters.

## Output Artifacts
- Audible alarms and the macOS settings pane.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `settingswindow.h/.cpp`, `desktop/macos/src/CMakeLists.txt`, `scripts/package-dmg.sh`, `scripts/check-dmg.sh` and the `macos` jobs in `.github/workflows/ci.yml` (search for `package-dmg.sh`).
2. Choose the backend:
   - Qt Multimedia keeps the code portable and testable on Linux, but adds a module to install in CI and plugins to bundle.
   - `NSSound` needs no new module, but it is only testable through the interface fake, and looping uses `setLoops:YES`.
   - Prefer Qt Multimedia unless `macdeployqt` cannot bundle it. Write the reason in the interface's header comment.
3. Settings: add a `QGroupBox` "Pomodoro" under the existing fields with a `QFormLayout`. Keep getters for each new widget, like the existing ones, so tests can reach them.
4. Lengths save independently of the connection save: call `PomodoroPreferences::save()` from `save()` after the existing checks, only when a value changed, and show its errors when they arrive.
5. Bundle the WAVs with a CMake `MACOSX_PACKAGE_LOCATION Resources/sounds` source property on the bundle target, or with a Qt resource file. Resolve them at runtime from `QCoreApplication::applicationDirPath() + "/../Resources/sounds"` or from `:/sounds`.
6. Run the Linux CTest, push, and check the CI `macos` job output for `check-dmg.sh`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>
