---
id: 13
group: "macos-pomodoro"
dependencies: [2, 3, 5]
status: "pending"
created: 2026-10-26
skills:
  - cpp-qt
  - qt-widgets
complexity_score: 6
complexity_notes: "Spans MenuBarApp, StatusMenu, StatusWords, StatusImage and one small Objective-C++ change that compiles only on the CI macos job."
execution_profile: "standard-implementation"
---
# macOS menu bar item and menu for Pomodoro mode

## Objective
Run the core Pomodoro session in the macOS menu bar app and show it: the hourglass after the logo, the countdown title, the tooltip and accessible name, primary-click routing, and the menu items for the mode and the session.

## Skills Required
C++ with Qt 6 Widgets (`QMenu`, `QAction`, `QImage`) in the portable `tokklmacos` library, plus a small Objective-C++ change for opening the menu from a primary click.

## Acceptance Criteria
- [ ] `MenuBarApp` creates a `SettingsPomodoroStore` on its `QSettings`, a `PomodoroPreferences`, a `PomodoroQueue` and a `PomodoroSession` next to the timer, with the same clock. The wake hook that calls `TimerController::resumed()` also reaches the session.
- [ ] A primary click calls `PomodoroSession::activate()`. On `OpenMenu` the item opens its menu: `StatusItem` gains a `popUpMenu()` method, implemented in `macstatusitem.mm` and in the test fake.
- [ ] `StatusImage` draws the hourglass after the logo and the project indicator whenever Pomodoro mode is on: the colour PNG normally, and the template PNG when the monochrome setting is on, so the system tints it like `mono_16x16.png`.
- [ ] `StatusWords`:
  - the menu bar title is the session's `countdownText` during a session, unless a timer runs or is paused;
  - `summary` and `itemName` use `<Phase> · <M:SS> left · Pomodoro <N> of <M>`, or `<Phase> · +<M:SS> overtime · Pomodoro <N> of <M>`, with phase names "Work", "Short rest" and "Long rest";
  - with Pomodoro mode on and no session, " · Pomodoro mode" is appended to the existing summary.
- [ ] `StatusMenu`:
  - the state line shows the session line and the session `message`;
  - "Start session", "Next phase: <Phase>" and "End session" show as on the other platforms;
  - a checkable "Pomodoro mode" action reads "Pomodoro mode (locked while running)" and is disabled while `modeLocked` is true;
  - Start Timer and Stop Timer show only in Timer mode or while a timer runs or is paused;
  - Project and Billable stay enabled during a session.
- [ ] `desktop/macos/autotests/menubarapptest.cpp` covers: the mode action and its lock; the hourglass in the status image in both icon modes; the title countdown and overtime; each `activate()` branch, including `popUpMenu()` on the fake; the menu per state; and the mode surviving a new `MenuBarApp` on the same settings.
- [ ] The portable build and CTest pass on Linux (configure `desktop/macos` with CMake, build, run `ctest`; read `desktop/macos/README.md` for the Linux steps). The `.mm` change compiles on the CI `macos` job, which is a required check on the PR.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read the kenkeep node `.ai/kenkeep/nodes/tooling-and-project/map-macos-menu-bar-app.md` first.
- Keep logic in the portable library. The Objective-C++ change is only the menu pop-up, for example `[statusItem.button performClick:nil]` with the menu attached, or `popUpStatusItemMenu:`. Pick the call that works on the deployment target in `desktop/macos/CMakeLists.txt`.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: the hourglass PNGs in `desktop/macos/resources/`.
- Task 3: `SettingsPomodoroStore`, `PomodoroPreferences`.
- Task 5: `PomodoroSession`.

## Output Artifacts
- The macOS menu bar item and menu in Pomodoro mode. `MenuBarApp` owns the session and preferences, which the alarm and settings task (task 14) uses.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `menubarapp.h/.cpp`, `statusmenu.h/.cpp`, `statuswords.h/.cpp`, `statusimage.h/.cpp`, `statusitem.h`, `macstatusitem.h/.mm`, `main.mm` and `menubarapptest.cpp` in full.
2. Add the new PNGs to the Qt resource list in `desktop/macos/src/CMakeLists.txt`, where the logo PNGs are compiled in.
3. `StatusImage` is a value type the item draws. Add a field for the hourglass, and draw it in `statusimage.cpp` after the indicator with the same spacing as between the logo and the indicator.
4. Expose `pomodoroSession()` and `pomodoroPreferences()` getters on `MenuBarApp` for task 14 and the tests.
5. Recompute the item from `updateItem()` on the session's change signals as well as the timer's.
6. Run the Linux CTest and `menubarapptest`. Push the branch so the CI `macos` job builds the `.mm` change. Record in the PR that the macOS UI was not checked by hand.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>
