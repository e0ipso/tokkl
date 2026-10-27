---
id: 5
group: "web-client"
dependencies: [4]
status: "pending"
created: 2026-10-27
skills:
  - react
  - typescript
complexity_score: 6
complexity_notes: "The provider rewrite and the deletion of the session modules must land together. Each deleted module is imported by the provider or by lib/session.ts. The e2e rewrite is task 7 and the pause chain is task 6."
execution_profile: "complex-architecture"
---
# Web Pomodoro views on the server state

## Objective
Make the web Pomodoro page, banner, nav marker and page title a view of `state.pomodoro`, call the server actions, and ring from the server's planned end. Delete the web's device-local session code.

## Skills Required
React and TypeScript.

## Acceptance Criteria
- [ ] `PomodoroSessionProvider.tsx` no longer keeps a session. It reads `state.pomodoro` from task 4's hooks and adds only the local alarm state. Its context exposes:
  - `session`, `phase`, `plannedEnd`, `transitionKind` and `now` (server-corrected);
  - `busy`, `ringing`, `audioBlocked`, `unlockAudio` and `retryAudio`;
  - `start(config, fields)`, `nextPhase()` and `end()`.
  `unsavedCount`, `updateFields`, `startTimer` and `pauseTimer` are gone.
- [ ] `PomodoroPage.tsx`:
  - the start form posts the per-session lengths and the entry fields through `useStartPomodoro`, with `created_with` set as the web sets it for timers;
  - the running view shows phase, countdown, overtime, "Pomodoro N of M" (`pomodoro.number` of `pomodoro.long_rest_every`) and the Next phase label, all from the server state;
  - editing the open pomodoro's fields sends a debounced v9 update of the running entry (`pomodoro.entry_id`);
  - the unsaved count is gone.
- [ ] `PomodoroSessionBanner.tsx`, the nav marker and the page title in `App.tsx` (the two `usePomodoroSession()` callers) work from the new context.
- [ ] Alarm and notification:
  - `pomodoroSessionAlarm.ts` rings when the server-corrected now reaches `phase.planned_end`, using `transition` for the sound and `phase.start` as the alarm key;
  - it stops when a state arrives with a different `phase.start` or no `pomodoro`, whichever device caused it;
  - `phaseNotification.ts` is keyed the same way.
- [ ] When a state carries a `discarded_pomodoro` this tab has not seen, the user sees "This pomodoro was too short to save." Action errors show task 4's offline and 409 messages.
- [ ] While `state.pomodoro` is non-null, `TimerBar.tsx` treats the running entry as the session's and shows its idle start form. Starting a timer there ends the session on the server. The `session.startTimer` and `session.pauseTimer` wrappers are gone, and their operations run directly. The local pause chain stays until task 6.
- [ ] Deleted, after `grep -rn` shows no remaining callers:
  - `pomodoroSessionController.ts` and its test;
  - `pomodoroSessionState.ts` and its test;
  - `pomodoroSessionLifecycle.ts`, `pomodoroSessionLock.ts`, `pomodoroSessionRetry.ts` and its test, and `pomodoroSessionTestSupport.ts`.
  `pomodoroSessionPresentation.ts` stays, typed against `TimerState['pomodoro']`.
- [ ] `lib/session.ts` drops `finishPomodoroSession`, `forgetActivePomodoroSession` and `forgetPomodoroSessions`, so logout no longer saves a pomodoro first. `lib/session.test.ts` is updated to match.
- [ ] `grep -rn "tokkl.pomodoroSession" packages/web/src` prints nothing.
- [ ] `npm test --workspace packages/web`, `npm run typecheck` and `npm run build` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Keep `pomodoroSessionAlarm.ts`'s audio handling as it is: the WAV loops, unlocking in the Start gesture, the retry after rejected audio and one audio owner across tabs. Change only what feeds it.
- The server applies every rule. Do not import `nextPhase`, `transitionKind` or `pomodoroEntrySpan` from `@tokkl/common/pomodoroSession` in the web. `plannedEnd` is not needed either, because the server sends it.
- Visible wording stays as it is unless a removed feature owned it.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 4: `useTimerState`, `useServerNow`, the action hooks and the shared error messages.

## Output Artifacts
- A server-driven Pomodoro UI with no local session storage.
- A `TimerBar.tsx` free of session coordination, which task 6 changes next.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read the current `PomodoroSessionProvider.tsx` in full, then `PomodoroPage.tsx`, `PomodoroSessionBanner.tsx`, `pomodoroSessionAlarm.ts`, `phaseNotification.ts`, `pomodoroSessionPresentation.ts`, `lib/session.ts` and the session parts of `TimerBar.tsx` (around lines 81, 235, 296 and 315).
2. List the callers of each module you plan to delete with `grep -rn "<module name>" packages/web/src e2e`. Move any helper that a kept file still needs before you delete its module.
3. The alarm's `current()` callback becomes:
   ```ts
   const p = state?.pomodoro;
   if (!p || serverNow() < Date.parse(p.phase.planned_end)) return null;
   return { key: p.phase.start, transition: p.transition };
   ```
   Call the alarm's refresh whenever a new state arrives and on the clock tick.
4. Field edits: the old `updateFields` changed local session fields. Now use the existing v9 update mutation (`useUpdateEntry` or whatever `hooks.ts` calls it) on `pomodoro.entry_id`. Debounce the description the way the timer bar does for a running entry.
5. Too-short notice: keep the last seen `discarded_pomodoro.entry_id` in a ref and toast once per new id.
6. TimerBar while a session runs: the current-entry cache now holds the pomodoro entry. Branch on `state.pomodoro` before the "running" branch and render the idle form.
7. Run the unit tests and typecheck after each deletion, so a missed import shows up early.
8. `e2e/timer-pomodoro-session.spec.ts` will fail after this task. Task 7 rewrites it, so leave it alone.
</details>
