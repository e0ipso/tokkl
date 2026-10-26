---
id: 6
group: "kde-pomodoro"
dependencies: [2, 3, 5]
status: "pending"
created: 2026-10-26
skills:
  - cpp-qt
  - linux-packaging
complexity_score: 6
complexity_notes: "Adds Qt Multimedia to the plasmoid and to three pinned CI images and two package formats; the C++ itself is small."
execution_profile: "complex-architecture"
---
# KDE backend: Pomodoro store, QML types, alarm player and packaging

## Objective
Give the plasmoid what its QML needs to run Pomodoro mode: a store in the widget's own configuration, QML names for the core Pomodoro classes, an alarm player that loops the chosen sound while the session rings and plays a preview, and the Qt Multimedia dependency in the build, the packages and the CI images.

## Skills Required
C++ with Qt 6 (QML registration, Qt Multimedia `QSoundEffect`, KConfig through the applet) and Linux packaging (CMake, `debian/control`, the RPM spec, the CI Dockerfiles).

## Acceptance Criteria
- [ ] `desktop/kde/src` has `AppletPomodoroStore`, a `PomodoroStore` that keeps the mode and records in a `Pomodoro` group of the applet's configuration, outside the settings schema, the same way `AppletChainStore` keeps the pause chain. Writes call `sync()`. Once applet and session are set, it hands itself to them, as `AppletChainStore` does with the timer.
- [ ] `desktop/kde/src/qmltypes.h` registers the core types for QML: the session as `TokklPomodoro`, the preferences client as `TokklPomodoroPreferences`, the store as `TokklPomodoroStore`, and the sound catalogue (ids, labels, default per transition) through a singleton or invokable helper.
- [ ] An `AlarmPlayer` QML type, for example `TokklAlarm`, has `ringing` (bool), `transition` (string) and `sounds` (map from transition to sound id). While `ringing` is true it loops the chosen WAV with `QSoundEffect` and `QSoundEffect::Infinite`. It stops as soon as `ringing` turns false. `preview(soundId)` plays a sound once and stops any earlier preview. `source` and `playing` are readable so tests can check them.
- [ ] The four WAVs from `TOKKL_POMODORO_SOUND_FILES` are installed with the plasmoid. The player resolves them without a hard-coded absolute path.
- [ ] `desktop/kde/package/contents/config/main.xml` has four string entries for the sound of each transition, defaulting to the matching sound id.
- [ ] Qt Multimedia is required in `desktop/kde/CMakeLists.txt`, listed in `desktop/kde/debian/control` and `desktop/kde/packaging/rpm/tokkl-kde.spec` (build and runtime), and installed in `desktop/kde/ci/Dockerfile`, `fedora.Dockerfile` and `ubuntu.Dockerfile`. `desktop/kde/scripts/check-package.sh` checks that the WAVs are in the package.
- [ ] A C++ test covers the store round trip in a test applet configuration (as `desktop/kde/autotests/appletchainstoretest.cpp` does) and the player's choice of `source` per transition, its stop when `ringing` turns false, and `preview()`.
- [ ] `desktop/kde/scripts/container-check.sh` passes for the Debian 13 leg (`--format deb`). Read the script header for its arguments.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Target stock Debian for the DEB, with Ubuntu as the fallback, not niche distributions.
- The core must stay free of Qt Gui and Qt Multimedia. Only `tokklkde` and the `tokklbackend` QML module link `Qt6::Multimedia`.
- Find the Debian and Fedora package names for Qt 6 Multimedia (development and runtime) and its audio backend. Confirm in the container that `QSoundEffect` loads a WAV (`status() == Ready`) with the backend you add.
- `desktop/kde/ci/image-id.sh` hashes the Dockerfiles, so changed images rebuild on their own.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: the sound catalogue and `TOKKL_POMODORO_SOUND_FILES`.
- Task 3: `PomodoroStore`, `PomodoroPreferences`.
- Task 5: `PomodoroSession`.

## Output Artifacts
- The QML types and the alarm player that the panel (task 7) and the settings page (task 8) use.
- The four sound entries in `main.xml`, which the settings page edits.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `desktop/kde/src/appletchainstore.h/.cpp` and copy its approach: find the applet's `KConfigGroup`, then a child group `Pomodoro`. Store the mode as a bool and each record as a string under a key derived from the owner. Because owners contain URLs, encode the key, for example as hex of a SHA-1 of the owner.
2. QML types: follow the `QML_FOREIGN` pattern in `qmltypes.h`. A type QML creates needs a default constructor; where the core type needs constructor arguments, add a KDE subclass the way `KdeConnection` wraps `Connection`. The session needs a clock, timer, preferences, queue and store. Create a KDE type that builds the preferences, queue and session from `connection`, `timer` and `store` properties once all are set. Keep that wiring in one class.
3. Alarm player: put it in `tokklkde`, or in the backend module if `tokklkde` must stay free of Multimedia; pick one and say why in its header comment.
   - On `ringing` true: set the source to the sound for `transition` (the `sounds` map, falling back to the catalogue default), `setLoopCount(QSoundEffect::Infinite)`, `play()`.
   - On false: `stop()`.
   - `preview(id)`: use a second `QSoundEffect` with loop count 1.
4. Sound installation: read `desktop/kde/package/CMakeLists.txt`. It copies `contents/` into the build directory and installs it as the package. Either copy the WAVs into `${_build_dir}/contents/sounds/` there, so QML and C++ can resolve them relative to the package, or install them to a data directory and resolve them with `QStandardPaths`. Choose the option that `check-package.sh` can verify most simply.
5. Packaging: add the build dependency and the runtime dependency (the multimedia library and the audio backend plugin package) to both package formats. `${shlibs:Depends}` covers the library but not a plugin; list the plugin package by name.
6. Tests: extend `desktop/kde/autotests/CMakeLists.txt`. Run the player test with the offscreen platform. Do not assert real audio output in CI; that is checked by hand with `pactl list sink-inputs`.
7. Run `desktop/kde/scripts/container-check.sh` for the Debian leg and read the CTest and package-check output.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Do not test that `QSoundEffect` makes sound; test which file the player picks and when it stops.
</details>
