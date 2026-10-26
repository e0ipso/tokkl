---
id: 5
group: "core-pomodoro"
dependencies: [1, 3, 4]
status: "pending"
created: 2026-10-26
skills:
  - cpp-qt
  - state-machines
complexity_score: 7
complexity_notes: "One class with many rules: mode lock, click routing, phases, ringing after sleep, saving, handoff and reconfiguration. The rules are fixed by the plan and the web controller, and splitting them would separate state changes that share one store write. The cycle, store and queue are already separate tasks."
execution_profile: "complex-architecture"
---
# Pomodoro session controller and timer handoff

## Objective
Add the core component that runs a Pomodoro session next to `TimerController`. It owns the mode, the phase, the alarm state, the open pomodoro's fields and the actions Start session, Next phase and End session. It publishes the state every panel shows, and it hands over to the timer according to the web's rules and the desktop decisions in the plan.

## Skills Required
C++20 with Qt 6 Core (QObject properties and signals, the `Clock` abstraction), and state-machine design for the session rules.

## Acceptance Criteria
- [ ] A `PomodoroSession` QObject in `desktop/core/src` takes the `Clock`, `TimerController`, `PomodoroPreferences`, `PomodoroQueue` and `PomodoroStore`. It does not own them. `TimerController`'s public behaviour is unchanged.
- [ ] Properties with change signals:
  - `pomodoroMode`, plus a setter that returns false and changes nothing while `modeLocked` is true;
  - `modeLocked`: a timer runs or is paused, or a session is active;
  - `active` and `phase` (`""`, `"work"`, `"shortRest"`, `"longRest"`);
  - `phaseStart` and `plannedEnd`;
  - `remainingSeconds` (rounded up) and `overtimeSeconds` (rounded down);
  - `countdownText`: `M:SS` before the planned end, `+M:SS` after it, with minutes not wrapped at 60;
  - `pomodoroNumber` (completed + 1 in work, completed in a rest) and `longRestEvery`;
  - `nextPhase`: the kind that Next phase would start;
  - `ringing` and `ringingTransition` (the transition name, or empty);
  - `canStartSession`;
  - `message`, which mirrors the queue's message and the too-short notice.
- [ ] `activate()` (left-click) returns one of `Handled`, `OpenMenu` or `Ignored`:
  - a timer running or paused: `TimerController::toggle()`, whatever the mode;
  - Timer mode: `TimerController::toggle()`;
  - Pomodoro mode with no session: Start session;
  - ringing: Next phase;
  - a session before its planned end: `OpenMenu`, and nothing else happens.
- [ ] Start session works only in Pomodoro mode, with no session and no timer running or paused, and with a bound account. It records the click instant, asks `PomodoroPreferences` to refresh, and starts at that instant with the values the read returns, or with the cached values when the read fails or the instance is unreachable. A length changed on the web therefore applies to the next session. A second Start while that read is in flight does nothing. The session snapshots the timer's `chosenProjectId` and `chosenBillable` and keeps the lengths it started with.
- [ ] Next phase follows `nextPhase` from task 1. Work to rest saves nothing. Rest to work snaps the pomodoro from `pomodoroStart` to the confirm instant with the account's `timeResolutionMinutes` and time zone, and hands it to the queue in the same store write as the new phase. The next pomodoro starts at the exact, unsnapped confirm instant.
- [ ] End session saves the open pomodoro from `pomodoroStart` to now the same way and clears the session.
- [ ] A span that snaps to nothing is not saved, and `message` becomes "This pomodoro was too short to save."
- [ ] `ringing` is true whenever a session is active and the clock is at or past `plannedEnd`. This is checked on every clock tick and on `resumed()`, and after a restart from the stored session. It stays true until Next phase or End session.
- [ ] Handoff: when the timer's current entry is a running entry with a start later than `pomodoroStart`, the session ends at that entry's start and the partial pomodoro is saved. The 30 s poll that already exists drives this.
- [ ] While a session is active and nothing runs, a change to the timer's chosen project or billable flag updates the stored session fields, so the open pomodoro and later ones use it.
- [ ] Before the connection's instance, sign-in method, email or secret changes, an active session ends at that instant, and `PomodoroQueue::flushForSignOut()` runs while the old context still exists. `Connection` gets a signal for this (for example `contextAboutToChange()`), emitted from those setters, and from the secret change, before the context is cleared.
- [ ] `formatCountdown(qint64 seconds, bool overtime)` is a static helper with the `M:SS` and `+M:SS` rules, like `TimerController::formatElapsed`.
- [ ] A new CTest test covers, with the fakes and lengths 1/1/1 and a long rest every 2:
  - a full cycle (start, ringing with `workToShortRest`, Next phase with no POST, ringing with `shortRestToWork`, Next phase with one stopped-entry POST whose span and `created_with` are right);
  - a skip still counting toward the long rest;
  - the long rest and the count reset;
  - End session in a rest;
  - the too-short message;
  - the mode lock while a timer runs, while it is paused and while a session is active;
  - each `activate()` branch;
  - handoff from a foreign running entry;
  - a restart after the planned end, ringing at once;
  - a project change mid-session reaching the saved entry;
  - the reconfiguration flush (one POST with the old authorization, then an empty queue).
- [ ] `desktop/core/ci/check.sh` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Web references: `start`, `nextPhase`, `end`, `observeTimer` and `updateFields` in `packages/web/src/components/pomodoroSessionController.ts`, and the "Pomodoro N of M" rule in `packages/web/src/pages/PomodoroPage.tsx` (around line 110).
- Desktop differences: no per-session length override, no pause in Pomodoro mode, no description. Starting a session never stops a timer, because it is refused while one runs or is paused. The desktop never starts a timer while Pomodoro mode is on, so every running entry seen during a session is foreign.
- Write the session to the store on every change, so a crash or restart keeps it. The record shape and owner come from task 3.
- Keep words out of core apart from the too-short message, which the queue's `message` path already carries. Platforms format the phase names and status lines.
- Qt Core only. Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 1: the cycle functions and the snap.
- Task 3: `PomodoroStore`, the session record and `PomodoroPreferences`.
- Task 4: `PomodoroQueue`.

## Output Artifacts
- `PomodoroSession`, which every platform renders: the KDE backend and panel (tasks 6, 7), tokkl-timerd (task 9) and the macOS app (task 13).
- `Connection::contextAboutToChange()`, or the equivalent signal.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read the class comment of `desktop/core/src/timercontroller.h` and write one for `PomodoroSession` in the same voice, listing the rules above.
2. State: keep one `std::optional<SessionRecord>` loaded from the store for the current owner. Reload it on `TimerController::contextChanged` and on a connection generation change. Every mutation:
   1. builds the new record;
   2. writes it to the store, in the same write as a new queue item when there is one, through the queue method from task 4;
   3. updates the properties and emits the signals.
3. Clock: connect `Clock::ticked`. On each tick, recompute `remainingSeconds`, `overtimeSeconds`, `countdownText` and `ringing`, and emit only when a value changes. Forward `resumed()` from the platform the same way `TimerController::resumed()` is called.
4. `canStartSession` is `pomodoroMode && !active && !timer.isRunning() && !timer.isPaused()` with an account bound. Check what `TimerController::isConnected()` returns while the instance is unreachable (Stale). If it stays true with the last validated account, starting offline works with the cached lengths, which the plan wants.
5. Handoff: connect `TimerController::currentEntryChanged`. If a session is active and `currentEntry()` runs with `start > pomodoroStart`, end the session at `start`. Snap the span from `pomodoroStart` to `start`. If `start <= pomodoroStart`, do nothing, as the web does.
6. Fields: connect `TimerController::choiceChanged`. If a session is active and no timer runs or is paused, write the new project and billable values into the record.
7. Reconfiguration hook in `Connection`:
   - Emit the signal in `setInstanceUrl`, `setAuthModeString`/`setAuthMode` and `setEmail` before the field changes and only when the value changes, and in `onSecretChanged` before `scheduleReload()`.
   - Read `Connection::reload()` and `send()` to confirm a request issued from the signal still goes out with the old authorization.
   - The test must prove it: change the instance URL while a session is active, then assert that the transport saw one POST with the old Authorization header and that the store's queue for the old owner is empty.
8. Do not route the menu's Start Timer through this class. Platforms hide it in Pomodoro mode, and tokkl-timerd refuses its `Start` method then (task 9).
9. Tests: one test file, for example `pomodorosessiontest.cpp`, with a helper that brings up a connected account with `time_resolution_minutes: 1` and a known time zone, and one test function per scenario in the acceptance list. Advance the fake clock and emit `ticked()` by hand.
10. Run `desktop/core/ci/check.sh`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Each scenario drives the real queue and store against the fake transport, so the save path is tested end to end.
</details>
