---
id: 10
group: "desktop-core"
dependencies: [9]
status: "pending"
created: 2026-10-27
skills:
  - cpp-qt
  - state-machines
complexity_score: 7
complexity_notes: "PomodoroSession's rewrite and the removal of the cycle, snap, queue and record code must land together, because the session is their only caller. Keeping the panels' property set unchanged limits the platform work in tasks 11, 13 and 14."
execution_profile: "complex-architecture"
---
# Desktop core: PomodoroSession on the server state, and removal of the ported rules

## Objective
Turn `PomodoroSession` into a view of `state.pomodoro` plus local alarm state, with start, next and end as server actions. Delete the core's cycle, snap, save queue and record code.

## Skills Required
C++20 with Qt 6 Core, and state-machine reasoning for the ringing and click rules.

## Acceptance Criteria
- [ ] `PomodoroSession` takes the `Clock`, `TimerController`, `TimerStateClient` and `PomodoroStore`. The panels see the same properties as today:
  - `pomodoroMode`, `modeLocked`, `active` and `phase`;
  - `phaseStart`, `plannedEnd`, `remainingSeconds`, `overtimeSeconds` and `countdownText`;
  - `pomodoroNumber`, `longRestEvery` and `nextPhase` (the upcoming phase);
  - `ringing`, `ringingTransition`, `canStartSession` and `message`.
  Each value comes from `state.pomodoro`, and the time comes from `TimerStateClient::serverNow()`.
- [ ] Start session sends the start action with the chosen project and billable flag and `created_with` set to the client name. It sends no length override. Next phase and End session send the current revision.
- [ ] `ringing` is true when a session is active and `serverNow()` is at or past `planned_end`. It is checked on every tick, on `resumed()` and on each new state. It turns false when a state arrives with a different phase start or no session, from any device.
- [ ] `activate()` rules:
  - an active session, started on any device and in either mode: ringing goes to Next phase, otherwise `OpenMenu`;
  - idle in Timer mode: `TimerController::toggle()`;
  - idle in Pomodoro mode: Start session.
  `modeLocked` is true while a timer runs or is paused, or a session is active.
- [ ] `message` shows "This pomodoro was too short to save." for a new `discarded_pomodoro`. It shows a connection message when an action fails with no network. The countdown and ringing continue from the last state while offline.
- [ ] Removed, after listing callers:
  - `pomodorocycle.*`, `snap.*`, `pomodoroqueue.*` and `pomodororecord.*`, with their tests (`pomodorocycletest.cpp`, `pomodoroqueuetest.cpp`) and CMake entries;
  - `createStoppedEntryDetached` and `Connection::contextAboutToChange`, if the queue was their only user.
  `isTimeResolution`, which `apitypes.cpp` uses, moves into `apitypes`.
- [ ] `pomodorostore.*` keeps only the mode and the per-transition sound picks. `pomodoropreferences.*` and `pomodorosounds.*` stay.
- [ ] `grep -rnE "pomodorocycle|pomodoroqueue|pomodororecord|snap\.h|ChainStore" desktop/core` prints nothing.
- [ ] `pomodorosessiontest.cpp` is rewritten around scripted states from the fake transport. It covers:
  - a session started elsewhere appearing in Timer mode, with `activate()` going to Next phase when ringing;
  - ringing at the planned end with a clock offset;
  - ringing stopping on a new phase state;
  - next and end sending the revision;
  - a 409 adopting the state with no second POST;
  - the too-short message;
  - the mode lock while a session is active;
  - the start body.
  `pomodorostoretest.cpp` matches the trimmed store.
- [ ] `desktop/core/ci/check.sh` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Keep the `formatCountdown` rules: `M:SS` before the planned end and `+M:SS` after it, with minutes not wrapped at 60.
- Rewrite the class comment in `pomodorosession.h` for the server-owned session.
- Platforms will not compile against the changed core until tasks 11, 13 and 14. Only the core check must pass here.
- Qt Core only. No plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 9: `TimerController` on the server state and its session-active signal.
- Task 8: `TimerStateClient` and the session actions.

## Output Artifacts
A server-driven `PomodoroSession` and a core without the ported rules. KDE (task 11), GNOME (task 13) and macOS (task 14) wire it up.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `pomodorosession.h/.cpp`, `pomodorostore.h/.cpp` and `pomodorosessiontest.cpp`, and the archived task that built them: `.ai/strikethroo/archive/02--pomodoro-mode-for-desktop-tray-apps/tasks/05--core-pomodoro-session-controller.md`.
2. Callers: `grep -rnE "pomodorocycle|PomodoroCycle|snapSpan|isTimeResolution|PomodoroQueue|PomodoroRecord|createStoppedEntryDetached|contextAboutToChange" desktop`. Platform callers are fixed in tasks 11, 13 and 14. Note them in your summary so those tasks can find them.
3. Ringing key: use the phase start, so the same phase never rings twice after a restart once it has been confirmed elsewhere.
4. Message for an offline action: reuse the connection's existing error wording if there is one. Otherwise expose an error flag and let the platforms word it.
5. Run `desktop/core/ci/check.sh` after each deletion.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
