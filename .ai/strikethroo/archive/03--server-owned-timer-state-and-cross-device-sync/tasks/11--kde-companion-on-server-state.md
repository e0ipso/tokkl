---
id: 11
group: "desktop-platforms"
dependencies: [10]
status: "completed"
created: 2026-10-27
skills:
  - cpp-qt
  - qml
complexity_score: 5
execution_profile: "standard-implementation"
---
# KDE companion on the server state

## Objective
Wire the KDE Plasma companion to the new core: drop its chain store and save queue wiring, and let the panel show and control a session started on another device in either mode.

## Skills Required
C++ with Qt 6 (QML type registration, KDE wiring) and QML for the panel and menu.

## Acceptance Criteria
- [ ] Removed:
  - `desktop/kde/src/appletchainstore.h/.cpp` and `autotests/appletchainstoretest.cpp`;
  - the `TokklChainStore` registration in `qmltypes.h`, and the chain store use in `package/contents/ui/main.qml`;
  - the CMake entries for all of these.
- [ ] `kdepomodoro.h/.cpp` builds `PomodoroSession` with task 10's constructor and creates or receives the `TimerStateClient`. Nothing feeds the removed queue or record. `AppletPomodoroStore` keeps the mode and the sound picks only.
- [ ] `PanelMenu.qml`, `PanelButton.qml` and `StatusText.qml` show Next phase, End session, the phase, the countdown and "Pomodoro N of M" whenever a session is active, also in Timer mode. The timer Start/Stop item is hidden while a session is active. The Pomodoro mode item stays locked while anything runs.
- [ ] The panel shows the core's `message`: the too-short notice and offline errors.
- [ ] `kdepomodorotest.cpp`, `appletpomodorostoretest.cpp`, `panelquicktest.cpp` and the QML tests under `autotests/qml` cover the new rules. That includes a foreign session shown in Timer mode with its menu items. Tests of removed code are deleted.
- [ ] `grep -rn "ChainStore\|PomodoroQueue\|PomodoroRecord" desktop/kde` prints nothing.
- [ ] The KDE CTest suite passes as CI runs it. Run `desktop/kde/scripts/container-check.sh --version "$(node -p 'require("./package.json").version')" --format deb --output "$(mktemp -d)"`, or the local build from `desktop/kde/README.md` (`cmake -S desktop/kde -B desktop/kde/build` then `ctest --test-dir desktop/kde/build --output-on-failure`) when the KDE dependencies are installed.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Keep the menus, glyph, label, settings page and sound player as they are, apart from the session visibility rule above.
- Wording follows the existing panel strings.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 10, and through it tasks 8 and 9: the new core API.

## Output Artifacts
A KDE companion that builds and passes its tests against the new core. Task 12 extends its real-server test.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Start with `grep -rnE "ChainStore|chainStore|PomodoroQueue|PomodoroRecord|contextAboutToChange|TimerStateClient" desktop/kde` to find every place that breaks against the new core. Read task 10's summary for the platform callers it listed.
2. `kde/src/kdepomodoro.h` documents what `PomodoroSession` takes. Update that comment and the constructor wiring.
3. In QML, find the visibility conditions that read `pomodoroMode`. For example `PanelMenu.qml` line 39 (`pomodoroIdle`). Make the session items depend on `session.active`, not on the mode.
4. Read `.ai/kenkeep/nodes/tooling-and-project/kde-companion/plasma-companion/` for the QML type and test layout.
5. Build and run the tests after each change.
</details>
