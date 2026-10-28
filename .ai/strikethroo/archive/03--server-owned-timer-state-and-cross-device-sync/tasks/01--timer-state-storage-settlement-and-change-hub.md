---
id: 1
group: "api-timer-state"
dependencies: []
status: "completed"
created: 2026-10-27
skills:
  - typescript
  - sqlite
complexity_score: 6
complexity_notes: "Many write paths share one settlement rule. Splitting storage from settlement would leave tables nothing keeps consistent, and the per-path tests check both together. The actions and HTTP layer are separate tasks."
execution_profile: "complex-architecture"
---
# Timer state storage, settlement on every entry write, and the change hub

## Objective
Add per-user storage for the Pomodoro session and the pause chain, a per-user revision, and an in-process change hub. Every time entry write ends a session or chain whose entry stopped, bumps the revision when the user's timer state changed, and publishes to the hub after the transaction commits.

## Skills Required
TypeScript on Node 24, and SQLite through `node:sqlite`: migrations, transactions and savepoints.

## Acceptance Criteria
- [ ] A new migration appended to `MIGRATIONS` in `packages/api/src/db/migrations.ts` creates three per-user tables, all deleted with their user:
  - the session: entry id, the four lengths it started with, phase kind, phase start and completed count;
  - the pause chain: workspace, description, project, task, tag ids, billable, stored seconds, and the running clone's entry id or null;
  - the timer state: `revision`, the fingerprint of the last settled state, and the last discarded pomodoro (entry id, start, stop) or null.
- [ ] A model module (for example `packages/api/src/models/timerState.ts`) exposes `touchTimer(db, userId)`. The outermost `transaction()` in `packages/api/src/db/index.ts` settles each touched user just before `COMMIT` and publishes to the hub just after it. A rollback publishes nothing.
- [ ] Settlement for one user:
  - A session whose entry is no longer the running entry is deleted. That covers a stopped, deleted, purged or trashed entry, and another entry running. When the session entry is in the trash with zero length, the timer state records it as the last discarded pomodoro.
  - A chain whose clone no longer runs is cleared. A paused chain (no clone) is cleared when any entry runs.
  - The fingerprint covers the running entry's row fields (id, workspace, project, task, description, start, billable, tag ids), the session row and the chain row. When it differs from the stored one, `revision` goes up by 1, the new fingerprint is stored and the hub gets one publish. If the change discarded no pomodoro, the last discarded pomodoro is cleared in the same step.
  - An edit to the running pomodoro entry's start keeps the session and its phase start. The open pomodoro's start is read from the entry, so nothing else moves.
- [ ] Every one of these paths calls `touchTimer`: `createTimeEntry`, `updateTimeEntry`, `stopTimeEntry`, `deleteTimeEntry` (now wrapped in `transaction`), `restoreTimeEntry`, `patchTimeEntries`, `purgeDeletedEntries`, `deleteProject` (when it deletes entries), and the CSV and JSON imports. `grep -rn "time_entries" packages/api/src` finds no other write that skips it.
- [ ] The hub (for example `packages/api/src/services/timerHub.ts`) lets callers subscribe and unsubscribe per user. It runs in process, with no broker and no new dependency.
- [ ] `packages/api/test/timerState.test.ts` sets up a session row and a chain row directly in the database, then covers:
  - a v9 stop, delete, an edit that adds a stop, a bulk PATCH stop, a new start, a project delete with its entries, and a trash purge each end the session and publish exactly once;
  - a v9 stop that rounds to zero records the discarded pomodoro;
  - a start that is not the clone clears a paused chain, and stopping the clone through v9 clears the chain;
  - an edit to the running pomodoro entry's start keeps the session;
  - an edit to an older stopped entry keeps the revision and publishes nothing;
  - a write that fails with 400 publishes nothing.
- [ ] `npm test --workspace packages/api` and `npm run typecheck` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- `node:sqlite` `DatabaseSync`. `transaction()` already joins nested calls through `db.isTransaction`. `patchTimeEntries` uses savepoints inside the route's transaction.
- `stopEntryAt` in `packages/api/src/models/timeEntries.ts` already trashes a stop that rounds to zero and gives it zero length on its snapped start. Settlement detects a discarded pomodoro from that.
- No circular imports: `db/index.ts` must not import model modules. Give it a small hook API instead, for example `beforeCommit(db, key, fn)` and `afterCommit(db, fn)`, that `touchTimer` registers with.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
None.

## Output Artifacts
- The three tables and `touchTimer`, which the actions in task 2 rely on.
- The change hub, which the SSE route in task 3 subscribes to.
- A settle function task 2 calls before reading the state, so a missed write path heals on the next read.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `packages/api/src/db/index.ts`, `packages/api/src/db/migrations.ts` and `packages/api/src/models/timeEntries.ts` in full. Copy the migration style (one SQL string per entry, `PRAGMA user_version` bump done by `migrate`).
2. Table design suggestion:
   - `pomodoro_sessions(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, entry_id INTEGER NOT NULL, work_minutes, short_rest_minutes, long_rest_minutes, long_rest_every, phase_kind TEXT CHECK (phase_kind IN ('work','shortRest','longRest')), phase_start TEXT, completed INTEGER)`.
   - `pause_chains(user_id INTEGER PRIMARY KEY ..., workspace_id, description, project_id, task_id, tag_ids_json TEXT, billable INTEGER, seconds INTEGER, clone_entry_id INTEGER NULL)`.
   - `timer_states(user_id INTEGER PRIMARY KEY ..., revision INTEGER NOT NULL DEFAULT 0, fingerprint TEXT, discarded_entry_id INTEGER NULL, discarded_start TEXT NULL, discarded_stop TEXT NULL)`.
   - Do not add a foreign key from `entry_id` to `time_entries`, because a purge deletes the row and settlement must see that.
3. Commit hooks in `db/index.ts`:
   - Keep a `WeakMap<Db, { before: Map<string, () => void>; after: (() => void)[] }>`.
   - In the outermost `transaction()`, run the `before` callbacks after `fn()` and before `COMMIT`, then `COMMIT`, then run the `after` callbacks. Clear both lists on commit and on rollback.
   - A `before` callback may write, so it runs inside the transaction.
4. `touchTimer(db, userId)` registers `before` key `timer:<userId>` (one per user per transaction) that calls `settleTimer(db, userId)`. If `settleTimer` bumps the revision, it registers an `after` callback that calls `hub.publish(userId)`.
5. `settleTimer(db, userId)`:
   1. Read the running entry (`getRunningEntry`), the session row and the chain row.
   2. If a session exists and the running entry's id is not `session.entry_id`, delete the session. Then read the session entry with deleted rows included. If it has `deleted_at` set and `start === stop`, store it as the discarded pomodoro.
   3. If a chain has `clone_entry_id` and the running entry's id differs, delete the chain. If a chain has no clone and any entry runs, delete the chain.
   4. Build the fingerprint as JSON of `{running: [id, workspace_id, project_id, task_id, description, start, billable, tagIds], session: row, chain: row}`. Compare it with the stored one. If it differs, upsert `timer_states` with `revision + 1` and the new fingerprint. Clear the discarded fields unless step 2 set them in this call. Then register the publish.
6. Call `touchTimer(db, user.id)` from each write path listed in the acceptance criteria, inside its transaction. `deleteTimeEntry` and `purgeDeletedEntries` are not in a transaction today, so wrap them. `deleteProject` touches entries of possibly many users; touch each user who had an entry in the project, or touch the acting user and every member of the workspace. Read the import services (`services/importCsv.ts`, `services/importJson.ts`) to see whether they run inside one transaction, and touch once per import.
7. Hub: `subscribe(userId, listener): () => void`, `publish(userId)`. Listeners must not throw into the commit path, so catch and log. Task 3 adds stream bookkeeping on top of it, or extends it.
8. Tests: use `setup()` from `packages/api/test/helpers.ts`, `testServer` for v9 calls, and subscribe to the hub to count publishes. Insert session and chain rows with SQL that matches your schema. Set the instance resolution to 1 minute where snapping matters (read `packages/api/test/settings.test.ts` for how).

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
