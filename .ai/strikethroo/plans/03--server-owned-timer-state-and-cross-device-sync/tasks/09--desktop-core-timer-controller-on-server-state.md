---
id: 9
group: "desktop-core"
dependencies: [8]
status: "pending"
created: 2026-10-27
skills:
  - cpp-qt
  - state-machines
complexity_score: 7
complexity_notes: "TimerController is about 1300 lines. Its pause chain, polling and unknown-outcome rules change together, and the never-replay tests must be rewritten against the new endpoints in the same step. PomodoroSession is task 10."
execution_profile: "complex-architecture"
---
# Desktop core: TimerController on the server state

## Objective
Drive `TimerController`'s running, paused and elapsed state from `TimerStateClient`. Make Pause, Resume and Stop-while-paused server actions, and remove the core's chain store and its recovery reads.

## Skills Required
C++20 with Qt 6 Core, and state-machine reasoning for the busy and unknown-outcome rules.

## Acceptance Criteria
- [ ] `TimerController` takes a `TimerStateClient`. It gets its current entry, paused state and chain total from `state()` instead of its own 30 s current-entry poll. The poll, wake and reconnect triggers now live in, or drive, `TimerStateClient`.
- [ ] While `state.pomodoro` is set, the running entry belongs to the session. `isRunning()` and `isPaused()` are false, `toggle()` does nothing, and a new `sessionActive` (or equivalent) property is true. Task 10 reads it, and the platforms use it for the mode lock.
- [ ] Start and Stop stay v9 calls, as today. Pause calls the pause action. Resume calls the resume action with the revision. Stop while paused calls discard with the revision.
- [ ] Elapsed time is `pause.seconds` plus the clone's time since its start, using `TimerStateClient::serverNow()`, and frozen at `pause.seconds` while paused. While paused, the project and billable flag come from `pause`.
- [ ] The never-replay rule holds for all six writes. An unknown outcome keeps the controller busy until the next state read settles it, and the request is never sent again. A 409 adopts the returned state and ends the busy state.
- [ ] Removed:
  - `chainstore.h/.cpp`, `SettingsChainStore` and `TimerController::setChainStore`;
  - the recent-entries read that confirmed a pause with no answer;
  - their CMake entries.
  `grep -rn "ChainStore" desktop/core` prints nothing.
- [ ] `timercontrollertest.cpp` covers:
  - pause, resume and discard against the new endpoints;
  - the chain total;
  - a pause with no answer settled by the next state;
  - a resume timeout with no second POST;
  - a 409 on resume;
  - a session state making the controller report not running;
  - a pause made on another device appearing on the next stream event.
  The tests of removed code are deleted. The tests of unchanged start, stop, project and billable behaviour still pass.
- [ ] `desktop/core/ci/check.sh` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Keep the class comment in `timercontroller.h` accurate. Rewrite the pause, chain and polling paragraphs to describe the server-owned chain.
- Keep the generation rules: replies from an older generation never reach the controller.
- KDE, GNOME and macOS will not compile against the changed core until tasks 11, 13 and 14. Only the core check must pass here.
- Qt Core only in this class. No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 8: `TimerStateClient`, `TimerState`, and the action operations with their three outcomes.

## Output Artifacts
A `TimerController` with no chain store, and a session-active signal for `PomodoroSession` (task 10) and the platform menus (tasks 11, 13 and 14).

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `timercontroller.h` in full, the pause and resume paths in `timercontroller.cpp`, and the chain tests in `timercontrollertest.cpp`. The kenkeep node `.ai/kenkeep/nodes/tooling-and-project/kde-companion/practice-kde-timer-controller-rules.md` summarises the rules. Note which of them move to the server.
2. List callers before deleting: `grep -rn "ChainStore\|setChainStore\|confirmPause\|chainSeconds\|chainChanged" desktop`. Keep `chainSeconds()` and `chainChanged()` if platforms read them (GNOME's `ChainSeconds` D-Bus property does), and back them with the state.
3. Busy and unknown: keep the existing `busy` and `unknown` flags. For an action with an unknown outcome, set unknown and ask `TimerStateClient` to read now. Clear the flag when a state newer than the one seen before the request arrives.
4. Current entry: `Connection::currentEntry()` and `fetchCurrentEntry()` may still be used elsewhere (the last-project default, for example). Keep them where they have callers. `currentEntryChanged` should now fire when the state's running entry changes.
5. Run `desktop/core/ci/check.sh` after each step.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
