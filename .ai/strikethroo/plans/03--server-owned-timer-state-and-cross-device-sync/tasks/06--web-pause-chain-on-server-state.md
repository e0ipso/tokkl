---
id: 6
group: "web-client"
dependencies: [5]
status: "completed"
created: 2026-10-27
skills:
  - react
  - typescript
complexity_score: 5
execution_profile: "standard-implementation"
---
# Web pause chain on the server state

## Objective
Make the timer bar's Pause, Resume and Stop-while-paused server actions, show the chain total from the server state, and delete the web's local pause chain storage and coordination.

## Skills Required
React and TypeScript.

## Acceptance Criteria
- [ ] In `TimerBar.tsx`:
  - Pause calls `usePauseTimer`, Resume calls `useResumeTimer`, and Stop while paused calls `useDiscardPause`;
  - Stop while a clone runs stays a v9 stop, and the server ends the chain;
  - while paused, the bar shows Paused with `pause.seconds` frozen and fills its draft fields from `pause`;
  - while a clone runs, the elapsed time is `pause.seconds` plus the clone's time since its start, on the server-corrected clock.
- [ ] A pause made on another device shows as Paused, with the same total, on the next state that arrives.
- [ ] Deleted, after `grep -rn` shows no remaining callers:
  - `tabChain.ts` and its test;
  - `PauseCoordination.tsx` and its provider in `App.tsx`;
  - the storage parts of `pauseChain.ts` (`chainKey`, `parseChain`, `serializeChain`, `loadChain`, `saveChain`, `forgetChains`) and the local chain logic that the server state replaces. Delete the file and its test if nothing is left.
- [ ] `lib/session.ts` no longer calls `forgetChains` or `forgetTabChain`.
- [ ] Action errors show task 4's offline and 409 messages. After a 409, the bar shows the state the server returned.
- [ ] `grep -rn "tokkl.pauseChain" packages/web/src` prints nothing.
- [ ] `npm test --workspace packages/web`, `npm run typecheck` and `npm run build` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Server rules: Pause is refused during a Pomodoro session, so hide or disable Pause while `state.pomodoro` is set. Any non-resume start ends the chain on the server.
- Keep the bar's layout and wording. The e2e layout check ("the bar with Pause and Stop, or Resume and Stop, fits the screen") must still pass after task 7.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 4: `useTimerState`, `useServerNow` and the pause action hooks.
- Task 5: `TimerBar.tsx` without the session wrappers.

## Output Artifacts
A timer bar with no local chain storage, which task 7's e2e specs exercise.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `TimerBar.tsx` in full, plus `pauseChain.ts`, `tabChain.ts` and `PauseCoordination.tsx`. The kenkeep node `.ai/kenkeep/nodes/web-ui-behaviour/time-and-timers/practice-web-timer-bar-pause-chain-rules.md` describes today's rules. Use it to see which rules move to the server.
2. Replace `chainRef`, `reconcile`, `readTabChain`/`writeTabChain`/`subscribeTabChain` and `usePauseCoordination` with reads of `state.pause` and `state.running_entry`.
3. Elapsed time: `state.pause && !state.pause.paused ? state.pause.seconds + (serverNow - Date.parse(state.running_entry.start)) / 1000 : ...`. Keep the existing formatting helper.
4. Check `pauseChain.test.ts` for pure helpers that are still used (for example `snapshotOf` or `sameSnapshot`). Keep only those with a caller.
5. `e2e/timer-pause.spec.ts` will fail after this task. Task 7 rewrites it, so leave it alone.
</details>
