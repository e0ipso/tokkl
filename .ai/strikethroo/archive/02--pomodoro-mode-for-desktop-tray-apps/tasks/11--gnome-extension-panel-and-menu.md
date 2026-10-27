---
id: 11
group: "gnome-pomodoro"
dependencies: [2, 9]
status: "completed"
created: 2026-10-26
skills:
  - gjs
  - gnome-shell
complexity_score: 6
complexity_notes: "Two files (timer1.js helpers, indicator.js) plus the mock service and the Shell harness, across Shell 46–51. The logic stays in tokkl-timerd."
execution_profile: "standard-implementation"
---
# GNOME Shell extension: Pomodoro panel button and menu

## Objective
Show Pomodoro mode in the GNOME top bar button: the hourglass glyph, the countdown label, the accessible name, left-click routing through `Activate`, and the menu items for the mode and the session. Everything comes from the new `org.tokkl.Timer1` properties and methods.

## Skills Required
GJS for GNOME Shell 46–51 (St, PopupMenu, Gio D-Bus proxies), and the extension's Node and Shell test harnesses.

## Acceptance Criteria
- [x] `desktop/gnome/extension/timer1.js` gains pure helpers, testable in Node:
  - the countdown text from `PlannedEnd` and now: `M:SS` rounded up before the end, `+M:SS` rounded down after it;
  - the phase names "Work", "Short rest" and "Long rest";
  - the session line `<Phase> · <M:SS> left · Pomodoro <N> of <M>`, or `<Phase> · +<M:SS> overtime · Pomodoro <N> of <M>`;
  - the "Next phase: <Phase>" label;
  - the mode item label, "Pomodoro mode" or "Pomodoro mode (locked while running)".
- [x] `desktop/gnome/extension/indicator.js` shows the hourglass after the logo whenever `PomodoroMode` is true: the colour SVG normally, and `hourglass-symbolic.svg` when the `monochrome-icon` key is on. During a session, unless a timer runs or is paused, the label shows the countdown. The existing 1 s tick also runs while `SessionActive` is true. Timer mode and a running or paused timer look as they do today.
- [x] Left-click calls `Activate`, and opens the menu when the reply is `open-menu`. Keyboard activation follows the same path. Keep the existing Shell 50 click-gesture and Shell 51 key-controller handling.
- [x] The accessible name follows the session line during a session. With Pomodoro mode on and no session, " · Pomodoro mode" is appended to the existing text.
- [x] Menu:
  - the status line shows the session line during a session, and `SessionMessage` when it is set;
  - "Start session" (`StartSession`) shows when Pomodoro mode is on, no session is active and no timer runs or is paused;
  - "Next phase: …" (`NextPhase`) and "End session" (`EndSession`) show during a session;
  - a "Pomodoro mode" switch item (`SetPomodoroMode`) is insensitive while `ModeLocked` is true;
  - Start and Stop show only in Timer mode or while a timer runs or is paused;
  - Project and Billable stay sensitive during a session.
- [x] `desktop/gnome/extension/ci/mock-timer.js` implements the new properties and methods, and `desktop/gnome/extension/tests/timer1.test.js` covers the new helpers.
- [x] `desktop/gnome/extension/ci/shell-check.js` (or the harness file that drives the panel) checks: the mode switch and its lock; glyph visibility in both icon modes; the countdown and the overtime label; each `Activate` reply, including the menu opening; and the menu items per state.
- [x] `desktop/gnome/extension/ci/check.sh 49` exits 0. Run one Shell version locally; the PR's `gnome-extension` CI job covers 46–51.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read the kenkeep node `.ai/kenkeep/nodes/tooling-and-project/map-gnome-shell-extension-for-tokkl-timerd.md` first. It covers the version differences and both harnesses.
- `timer1.js` imports nothing from GNOME Shell or GTK, so Node can run its tests. Keep the new helpers pure.
- The extension holds no Pomodoro rules. It never decides ringing or phase changes on its own; the countdown is display only.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: `hourglass.svg` and `hourglass-symbolic.svg` in `desktop/gnome/extension/`.
- Task 9: the new `org.tokkl.Timer1` contract.

## Output Artifacts
- The GNOME panel button and menu in Pomodoro mode.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `indicator.js`, `timer1.js`, `projectindicator.js`, `ci/mock-timer.js`, `ci/shell-check.js`, `ci/shell-driver.js` and `ci/check.sh` in full.
2. Make sure the new SVGs are packed: read `desktop/gnome/scripts/pack-extension.sh` and add them with `--extra-source` if it lists files.
3. Glyph: a second `St.Icon` after `this._logo`, with a `Gio.FileIcon` for the colour file, or `Gio.ThemedIcon`/`FileIcon` on the symbolic file for monochrome, switched where the logo is switched (around line 193). Hide it when `PomodoroMode` is false.
4. Tick: the indicator already ticks while a timer runs. Extend the condition to `SessionActive`. Compute the label from `PlannedEnd` and `Date.now()` with the new helper.
5. Menu: add `PopupMenu.PopupMenuItem` items for the session actions and a `PopupMenu.PopupSwitchMenuItem` for the mode. Refresh visibility in the same function that refreshes Start/Stop today.
6. Mock: add the properties with defaults and the methods that change them, so the harness can drive each state.
7. Run `node --test desktop/gnome/extension/tests/`, then `desktop/gnome/extension/ci/check.sh 49`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>
