---
id: 2
group: "api-timer-state"
dependencies: [1]
status: "pending"
created: 2026-10-27
skills:
  - typescript
  - state-machines
complexity_score: 7
complexity_notes: "Six actions, the derived state and the revision check share one transaction and one set of rules from pomodoroSession.ts. Splitting session actions from pause actions would duplicate the state builder and the conflict handling. Storage and HTTP are separate tasks."
execution_profile: "complex-architecture"
---
# Timer state service: derived state, session actions and pause actions

## Objective
Build the server's timer state and the six actions that change it: start session, next phase, end session, pause, resume and discard. The server applies every rule, including the conflict check on the revision, and returns the values clients used to compute themselves.

## Skills Required
TypeScript, and state-machine logic built on `packages/common/pomodoroSession.ts`.

## Acceptance Criteria
- [ ] `packages/types/index.ts` exports `TimerState` with this shape (snake_case, like the v9 API):
  - `revision: number` and `server_time: string` (ISO 8601 with milliseconds);
  - `running_entry`: the running entry in the v9 shape with meta, or null;
  - `pause`: non-null for the whole life of a chain. It holds `paused` (true when no clone runs), `seconds` (stored so far), `workspace_id`, `description`, `project_id`, `task_id`, `tag_ids`, `tags`, `billable` and `clone_entry_id`;
  - `pomodoro`: null without a session. Otherwise it holds `work_minutes`, `short_rest_minutes`, `long_rest_minutes`, `long_rest_every`, `phase` (`kind`, `start`, `completed`, `planned_end`), `upcoming_phase`, `transition`, `number`, `entry_id` and `pomodoro_start`;
  - `discarded_pomodoro`: `{ entry_id, start, stop }` when the change that produced this revision discarded a too-short pomodoro, otherwise null.
- [ ] `getTimerState(db, user, now = new Date())` settles the user first (task 1's settle function), then builds the state. `planned_end`, `transition` and `upcoming_phase` come from `plannedEnd` and `transitionKind` in `packages/common/pomodoroSession.ts`. `number` is `completed + 1` in work and `completed` in a rest. `pomodoro_start` is the running entry's start.
- [ ] Action functions each run in one `transaction()`, take `now: Date = new Date()` as their last parameter and return the new `TimerState`:
  - `startPomodoro(db, user, body, now)`: refused when a session exists. It ends any chain and creates a running entry at `now` through `createTimeEntry`, which stops the running entry at `now`. The body may carry `workspace_id` (default: the user's default workspace), `description`, `project_id`, `task_id`, `tag_ids` or `tags`, `billable`, `created_with`, and overrides for the four lengths. Overrides are checked against `POMODORO_SESSION_CONFIG_RANGES`. Missing lengths come from the user's four `pomodoro_*` preferences. It stores the session with `startSession(now)`.
  - `nextPomodoroPhase(db, user, revision, now)`: uses `nextPhase`. Work to rest only changes the session row. Rest to work stops the entry at `now` the way `stopEntryAt` does. It then creates a new running entry at the exact `now`, copying workspace, project, task, description, tags, billable and `created_with` from the entry it stopped, and points the session at it.
  - `endPomodoro(db, user, revision, now)`: stops the entry at `now` and deletes the session.
  - `pauseTimer(db, user, now)`: refused during a session or when nothing runs. It stops the running entry at `now`. It records the entry's fields and adds its stored duration to the chain's seconds (zero when the stop rounded to zero). A pause of a clone extends the existing chain.
  - `resumeTimer(db, user, revision, now)`: refused unless paused. It creates a clone running at `now` with the chain's fields and records its id in the chain.
  - `discardPause(db, user, revision, now)`: refused unless paused. It clears the chain and writes no entry.
- [ ] `nextPomodoroPhase`, `endPomodoro`, `resumeTimer` and `discardPause` refuse a `revision` other than the current one. Every refusal, stale or not, throws an error that carries HTTP 409 and the current `TimerState`, so task 3 can send that state as the body. A non-integer revision is a 400.
- [ ] A too-short pomodoro (rest to work or End) goes to the trash through the existing stop rule, and the returned state's `discarded_pomodoro` names it.
- [ ] `packages/api/test/timerActions.test.ts`, with instance resolution 1 minute and lengths 1/1/1 and a long rest every 2, covers:
  - a full cycle in which work to short rest stores nothing, and short rest to work leaves one snapped stopped entry plus a new running entry with the same fields that starts at the exact confirm instant;
  - a skipped phase that still counts toward the long rest, then the long rest and the count reset;
  - End session during a rest;
  - a too-short pomodoro, both on rest to work and on End;
  - a stale revision getting 409 and advancing nothing;
  - start session stopping a running timer at the session start, and ending a paused chain;
  - length overrides, and defaults taken from the preferences;
  - an edit made through v9 to the running pomodoro entry that carries into the next pomodoro;
  - pause, resume, pause again adding up the seconds, then discard;
  - pause refused during a session.
- [ ] `npm test --workspace packages/api` and `npm run typecheck` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Run `packages/common/pomodoroSession.ts` as it is. Do not port or change its rules. Its fixtures stay the contract.
- Snapping, the trash rule and the 999-hour cap stay in `packages/api/src/models/timeEntries.ts`. Export what the actions need (for example `stopEntryAt`, or a small exported wrapper) instead of copying it.
- Every instant comes from `now`. The routes pass the server clock.
- Errors use `packages/api/src/lib/errors.ts`. Add a 409 error type that carries a JSON body, or let the action return a result the route turns into 409. `errorHandler` in `packages/api/src/app.ts` today sends `error.message` only.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 1: the tables, `touchTimer`, the settle function and the revision.

## Output Artifacts
- `TimerState` in `@tokkl/types`, used by the web (tasks 4 to 6) and mirrored by the desktop decoder (task 8).
- `getTimerState` and the six action functions, which the routes in task 3 call.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Put the service in `packages/api/src/models/timerState.ts` next to task 1's code, or in `packages/api/src/services/timerState.ts` if the model file grows too large. Follow the style of `timeEntries.ts`.
2. Reading the four preferences: see `getPreferences` and the `pomodoro_*` keys in `packages/api/src/models/users.ts`. Map them onto `PomodoroSessionConfig`.
3. Build `running_entry` with `serializeTimeEntry(row, { meta: true, user })`, as the v9 current-entry route does (`packages/api/src/routes/togglV9.ts`, `/me/time_entries/current`).
4. `pause.tags` are tag names for display. `tag_ids` are what a clone is created with. Resolve names with the tag model.
5. Rest to work, step by step, inside one transaction:
   1. `const stopped = stopEntryAt(db, user, entry, now)` (false means trashed);
   2. `createTimeEntry(db, user, entry.workspace_id, { start: now.toISOString(), description, project_id, task_id, tag_ids, billable, created_with, workspace_id })`;
   3. update the session row: the new `entry_id`, phase kind, phase start and completed count from `nextPhase`;
   4. task 1's settlement runs at commit, sees a consistent session and bumps the revision once.
   `createTimeEntry` calls `stopRunning`, which finds nothing to stop because the old entry is already stopped.
6. Pause, step by step: read the running entry, call `stopEntryAt`, then read the row again with deleted rows included. Its `stop - start` is the stored duration (zero when trashed). Upsert the chain: when `clone_entry_id` equals the paused entry, add to `seconds`, otherwise start from that duration. Set `clone_entry_id` to null.
7. Refusals: a 409 that carries `getTimerState(db, user, now)` as its body. Read the state inside the same transaction, so it matches what was refused.
8. `discarded_pomodoro` comes from the `timer_states` row that task 1's settlement maintains. Verify that a rest-to-work discard survives the commit-time settlement: settlement clears the discarded fields only when it did not set them in the same call. If the action records the discard itself, make sure settlement does not clear it.
9. Tests: call the functions directly with explicit `now` values, using `setup()` from `packages/api/test/helpers.ts`. Read `packages/api/test/preferences.test.ts` for preference setup and `settings.test.ts` for the resolution. Assert stored entries with `listTimeEntries` or the v9 list route.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
