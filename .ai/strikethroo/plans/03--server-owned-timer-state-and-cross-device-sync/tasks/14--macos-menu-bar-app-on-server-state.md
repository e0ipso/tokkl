---
id: 14
group: "desktop-platforms"
dependencies: [10]
status: "pending"
created: 2026-10-27
skills:
  - cpp-qt
complexity_score: 4
execution_profile: "standard-implementation"
---
# macOS menu bar app on the server state

## Objective
Wire the macOS menu bar app to the new core: drop its chain store and save queue wiring, and let the menu show and control a session started on another device in either mode.

## Skills Required
C++ with Qt 6 Widgets (`QMenu`, `QAction`), as in the portable part of the app.

## Acceptance Criteria
- [ ] `desktop/macos/src/menubarapp.h/.cpp` no longer builds `SettingsChainStore` or `PomodoroQueue`. It builds a `TimerStateClient` and `PomodoroSession` with task 10's constructor. `SettingsPomodoroStore` keeps the mode and the sound picks.
- [ ] In `statusmenu.cpp`, Next phase, End session and the session status show whenever a session is active, also in Timer mode. The timer toggle is hidden while a session is active. The mode action stays locked while anything runs. `statuswords.*` words the too-short and offline messages.
- [ ] `pomodoroalarm.*` and `settingswindow.h` lose any reference to removed classes.
- [ ] `autotests/menubarapptest.cpp` covers a session started elsewhere showing in Timer mode with its menu items, and drops tests of removed code.
- [ ] `grep -rn "ChainStore\|PomodoroQueue" desktop/macos` prints nothing.
- [ ] On Linux, the portable part builds and its tests pass: `cmake -S desktop/macos -B "$b" && cmake --build "$b" && ctest --test-dir "$b" --output-on-failure` exits 0. The `macos` CI job covers the Mac build.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- `desktop/macos/README.md` says `menubarapp.*`, `statusmenu.*`, `statuswords.*` and `settingswindow.*` need only Qt Widgets and the core, and build and test on Linux. Keep that true.
- Objective-C++ files (`*.mm`) change only if they reference removed classes.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 10, and through it tasks 8 and 9: the new core API.

## Output Artifacts
A macOS app that builds and passes its portable tests against the new core.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Start with `grep -rnE "ChainStore|PomodoroQueue|PomodoroRecord|contextAboutToChange" desktop/macos`.
2. `statusmenu.cpp` line 235 holds the Pomodoro-idle rule, and line 262 the locked label. Make the session items depend on `PomodoroSession::active()`.
3. If the Linux build needs a CMake prefix for Qt, follow how CI or `desktop/macos/README.md` configures it.
</details>
