---
id: 7
group: "kde-pomodoro"
dependencies: [2, 6]
status: "pending"
created: 2026-10-26
skills:
  - qml
  - kirigami
complexity_score: 6
complexity_notes: "Touches four QML files and the QML test fixture, but every rule comes from the core session and the strings are fixed below."
execution_profile: "standard-implementation"
---
# KDE panel item and menu for Pomodoro mode

## Objective
Show Pomodoro mode in the plasmoid: the hourglass glyph, the countdown label, the tooltip and accessible name, left-click routing, and the menu items for the mode and the session. Wire the alarm player to the session's ringing state.

## Skills Required
QML with Kirigami and Plasma components for the panel and menu, and Qt Quick Test for `autotests/qml/tst_panel.qml`.

## Acceptance Criteria
- [ ] `desktop/kde/package/contents/ui/main.qml` creates the session, its store and the alarm player from task 6, next to the existing timer and chain store. The player's `ringing` and `transition` follow the session, and its `sounds` follow the four sound entries in `Plasmoid.configuration`.
- [ ] `PanelButton.qml` shows the hourglass next to the logo whenever Pomodoro mode is on: the colour glyph normally, and the tinted single-colour glyph when `monochromeIcon` is on. During a session, unless a timer runs or is paused, the label shows the session's `countdownText`. Timer mode, and any running or paused timer, look exactly as they do today.
- [ ] Left-click calls the session's `activate()` and opens the menu when it returns `OpenMenu`.
- [ ] Tooltip and accessible name during a session read `<Phase> · <M:SS> left · Pomodoro <N> of <M>`, or `<Phase> · +<M:SS> overtime · Pomodoro <N> of <M>` in overtime. Phase names are "Work", "Short rest" and "Long rest". With Pomodoro mode on and no session, the existing text gets " · Pomodoro mode" appended.
- [ ] `PanelMenu.qml`:
  - The status line shows the session text above during a session, and the session's `message` when there is one.
  - "Start session" appears when the session can start.
  - "Next phase: Short rest", "Next phase: Long rest" or "Next phase: Work" appears during a session.
  - "End session" appears during a session.
  - A checkable "Pomodoro mode" item reads "Pomodoro mode (locked while running)" and is disabled while `modeLocked` is true.
  - The existing Start and Stop items appear only in Timer mode or while a timer runs or is paused.
  - Project and Billable stay enabled during a session.
- [ ] `StatusText.qml` holds the new words, with `i18n`/`i18nc` like the existing strings.
- [ ] `desktop/kde/autotests/qml/tst_panel.qml` covers: the mode item and its lock while a timer runs and while a session is active; glyph visibility in both modes and in monochrome; the countdown and the overtime label; each left-click branch, including the menu opening mid-phase; the menu items per state; and the tooltip text. `desktop/kde/autotests/panelquicktest.cpp`'s `PanelFixture` exposes what the tests need.
- [ ] `desktop/kde/scripts/container-check.sh` passes for the Debian 13 leg, with the new QML tests listed as passed.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read the kenkeep node `.ai/kenkeep/nodes/tooling-and-project/kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md` before changing the panel. It describes clicks, keys, the Start/Stop item and the indicator.
- Keyboard activation (Space, Enter, the Menu key) must follow the same routing as the mouse, as the existing button does.
- No logic beyond display and routing in QML. Every rule comes from the session's properties.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: the hourglass files in `desktop/kde/package/contents/images/`.
- Task 6: the QML types, the alarm player and the sound entries in `main.xml`.

## Output Artifacts
- The KDE panel and menu in Pomodoro mode, checked by the plan's screenshot and `pactl` steps.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `main.qml`, `PanelButton.qml`, `PanelMenu.qml`, `StatusText.qml`, `tst_panel.qml` and `panelquicktest.cpp` in full first.
2. Glyph: use `Kirigami.Icon` with `source` set to the image file. For the single-colour version, use `isMask: true` and `color` from the same source the monochrome logo uses (see how `monochromeIcon` picks `tokkl-mono-dark.png` or `tokkl-mono-light.png`). Size it like the project indicator (`Kirigami.Units.iconSizes.small`).
3. Label: wherever the panel currently shows `timer.elapsedText`, use `session.countdownText` when `session.active && !timer.running && !timer.paused`.
4. Click: replace the direct `timer.toggle()` call with a call to `session.activate()`. Compare the result with the enum value the QML type exports, and open the menu on `OpenMenu`.
5. Menu: add the items with `visible` and `enabled` bindings. Keep the existing order: status line, then the session items, then Start/Stop, Project, Billable, then the mode item before Reconnect.
6. Tests: extend `PanelFixture` to build a session (with the fakes) and expose it. Use the fake clock to reach the planned end. Use `findChild` by `objectName`, as the existing tests do, and give new items object names.
7. Run the Debian container check. Then, if time allows, run the plasmoid on the headless sway session (`WAYLAND_DISPLAY=wayland-headless plasmawindowed <plasmoid id>`) and take a screenshot to check the glyph at panel size.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Group the cases into a few test functions by state (Timer mode, Pomodoro idle, in session, ringing).
</details>
