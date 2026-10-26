---
id: 4
group: "core-pomodoro"
dependencies: [1, 3]
status: "pending"
created: 2026-10-26
skills:
  - cpp-qt
  - rest-api
complexity_score: 6
complexity_notes: "Small surface, but it carries the no-duplicate and no-loss guarantees for saved pomodoros: write before post, exact-match check before a retry, and the 4xx rules."
execution_profile: "complex-architecture"
---
# Durable save queue for ended pomodoros

## Objective
Add a core queue that saves ended pomodoros as stopped time entries. It persists each item before posting, retries with back-off, checks the server for an exact match before posting an item again, and drops items the server rejects for good. The rules are those of `packages/web/src/components/pomodoroSessionController.ts` and `pomodoroSessionRetry.ts`.

## Skills Required
C++20 with Qt 6 Core for the queue, and REST client work on `Connection` for the stopped-entry POST and the entries lookup.

## Acceptance Criteria
- [ ] `Connection` gains `createStoppedEntry`: `POST /api/v9/workspaces/{wid}/time_entries` with `start`, `stop`, `duration`, `project_id` (or null), `billable`, `description` `""`, empty `tags`, `workspace_id` and `created_with` set to the connection's client name.
- [ ] `Connection` gains `fetchEntriesBetween(start, end)`: `GET /api/v9/me/time_entries?start_date=<start>&end_date=<end>`, decoded with the existing entry decoder.
- [ ] A `PomodoroQueue` class in `desktop/core/src` takes the connection, the clock and the store. Callers hand it a new unsaved item in the same store write as the session change, through a method that takes both.
- [ ] Before each POST, the queue writes the item back with `attempts + 1` and `retryAt = now + delay(attempts + 1)`, where `delay(n) = min(300 s, 5 s × 2^min(6, max(0, n − 1)))`. Only after the write succeeds does it send the request.
- [ ] Before posting an item whose `attempts > 0`, the queue reads the entries between its start and stop. When one has the same start and a stop equal to the item's, the item is removed and nothing is posted. A failed lookup keeps the item for later.
- [ ] A 2xx reply removes the item. A 4xx other than 401, 408 and 429 removes it and publishes the server's message. Any other failure keeps it until its `retryAt`.
- [ ] Items are posted one at a time. The queue checks due items on clock ticks, and at once when the connection becomes Connected. It posts only items whose owner matches the connection's current owner.
- [ ] `flushForSignOut()` posts each item that has never been tried once, sends nothing for items already tried, and then removes every item of that owner. This is the web's sign-out rule.
- [ ] A `message` property (with a change signal) carries the last message for the user and is cleared by `clearMessage()`.
- [ ] A new CTest test drives the queue with the fakes in `desktop/core/autotests/fakes.h` and covers: the store holds the attempted item before the transport sees the POST; a transient failure followed by a retry after the delay; an exact match found on retry, with no second POST; a 422 dropped with its message; a 401 kept; a new queue on the same store resuming after a restart; and `flushForSignOut()`. `desktop/core/ci/check.sh` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- The web reference is `save`, `remove` and `retry` in `pomodoroSessionController.ts`, and `pomodoroRetryDelay`, `irrecoverablePomodoroError` and `hasSavedPomodoro` in `pomodoroSessionRetry.ts`. Port the behaviour, not the browser-specific locking.
- Compare instants as `QDateTime`s, not strings.
- Read `Connection::call` to see how replies from an earlier generation are dropped; the queue must not apply them.
- The queue never edits or deletes server entries.
- Qt Core and Network only. Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 1: the snapped span type.
- Task 3: `PomodoroStore`, the unsaved-item record and its serialisation.

## Output Artifacts
- `PomodoroQueue`, used by the session controller (task 5) to save pomodoros and to flush on reconfiguration.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Add an encoder next to `encodeStartEntry` in `apitypes.cpp`, for example `encodeStoppedEntry(const UnsavedPomodoro &, const QString &createdWith)`. Send `start` and `stop` in UTC ISO 8601 and `duration` as whole seconds. Snapped spans are whole minutes, so the duration is an integer.
2. Add `fetchEntriesBetween` with a `QUrlQuery`. `start_date` and `end_date` take the ISO instants. The web sends `entry.start` and `entry.stop`.
3. Queue design:
   - Hold no copy of the queue in memory that can disagree with the store. Read the record from the store, change it, write it back.
   - Keep one in-flight flag. When a POST or lookup finishes, look for the next due item.
   - On `Clock::ticked`, run when `now >= min(retryAt)` and nothing is in flight. On `Connection::stateChanged` to Connected, run with `force = true`, so `retryAt` is ignored once.
   - Owner string: use the same composition as `TimerController::chainOwner()` (instance, account id and workspace id). Expose a helper in core rather than copying the code if the owner is private.
4. The method that takes a session change and a new item writes both in one `saveRecord` call, then starts processing. Task 5 calls it for rest-to-work, End session and handoff.
5. `flushForSignOut()` must send while the old context still exists. Task 5 calls it before the connection changes. Send the POSTs, then remove the owner's items from the store at once; do not wait for replies, which belong to the old generation.
6. Tests: script the fake transport's replies in order. To assert write-before-post, give the test a store subclass that records each `saveRecord` call, and compare the order with the transport's request log. Advance the fake clock past `retryAt` and emit `ticked` to trigger retries.
7. Run `desktop/core/ci/check.sh`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>
