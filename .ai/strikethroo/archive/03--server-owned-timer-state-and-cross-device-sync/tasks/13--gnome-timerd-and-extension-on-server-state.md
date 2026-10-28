---
id: 13
group: "desktop-platforms"
dependencies: [10]
status: "completed"
created: 2026-10-27
skills:
  - cpp-qt
  - gjs
complexity_score: 5
execution_profile: "standard-implementation"
---
# GNOME tokkl-timerd and extension on the server state

## Objective
Wire `tokkl-timerd` to the new core, adjust `org.tokkl.Timer1` as needed, and let the GNOME extension show and control a session started on another device in either mode.

## Skills Required
C++ with Qt 6 (QtDBus service), and GJS for the GNOME Shell extension.

## Acceptance Criteria
- [ ] `desktop/gnome/src/timerservice.h/.cpp` no longer builds `SettingsChainStore` or `PomodoroQueue`. It builds a `TimerStateClient` and `PomodoroSession` with task 10's constructor. `ChainSeconds` and the session properties are backed by the new core.
- [ ] `desktop/gnome/dbus/org.tokkl.Timer1.xml` changes only where the core's properties or methods changed. Methods that the removed code fed are dropped. `timerd` and the extension ship together, so no compatibility shim is needed.
- [ ] In `desktop/gnome/extension/indicator.js` (around lines 368 to 386), Next phase, End session and the session status show whenever a session is active, also in Timer mode. The timer toggle is hidden while a session is active. The mode item stays locked while anything runs. `timer1.js` and `ci/mock-timer.js` match any D-Bus change.
- [ ] `autotests/timerservicetest.cpp` covers a session started elsewhere appearing on D-Bus, and Next phase and End session calls going to the server actions. `autotests/keychainstoretest.cpp` and `autotests/CMakeLists.txt` drop anything that referenced removed classes. The extension tests (`extension/tests/*.test.js`) pass.
- [ ] `grep -rn "ChainStore\|PomodoroQueue" desktop/gnome` prints nothing.
- [ ] These exit 0:
  - `desktop/gnome/ci/check.sh`;
  - `node --test 'desktop/gnome/extension/**/*.test.js'`;
  - `tsc -p desktop/gnome/extension/ci/tsconfig.json`;
  - `desktop/gnome/extension/ci/check.sh <one Shell version>`. Run one version locally; the CI job covers 46 to 51.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Keep the menus, glyph, label, preferences and alarm player.
- Keep the D-Bus property and method naming style of `org.tokkl.Timer1`.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 10, and through it tasks 8 and 9: the new core API.

## Output Artifacts
A GNOME companion that builds and passes its tests against the new core.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Start with `grep -rnE "ChainStore|PomodoroQueue|PomodoroRecord|SettingsPomodoroStore|contextAboutToChange" desktop/gnome` and read `timerservice.cpp` around lines 80 to 100, where the core objects are built and connected.
2. Compare the D-Bus property list in `timerservice.cpp` (around line 585) with the new `PomodoroSession` and `TimerController` properties. Change only what no longer has a source.
3. Extension: the state object is built in `indicator.js` around line 328. Change `_toggleItem.visible` and `_startSessionItem.visible`, and add a session-active rule for the Next and End items.
4. Plan's self-validation, as a manual check: build `tokkl-timerd`, run it against a local server, start a session with `gdbus call --session --dest org.tokkl.Timer1 ...`, and read the properties back after ending it from the web.
</details>
