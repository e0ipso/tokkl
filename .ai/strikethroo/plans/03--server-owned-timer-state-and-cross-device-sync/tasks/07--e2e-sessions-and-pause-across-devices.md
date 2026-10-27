---
id: 7
group: "web-client"
dependencies: [5, 6]
status: "pending"
created: 2026-10-27
skills:
  - playwright
complexity_score: 5
execution_profile: "standard-implementation"
---
# E2E: Pomodoro sessions and pause on the server state, across devices

## Objective
Rewrite the Pomodoro session and pause e2e specs for the server-owned state. Add two-context tests that prove a change on one device reaches the other, and get the whole e2e suite green.

## Skills Required
Playwright end-to-end testing.

## Acceptance Criteria
- [ ] `e2e/timer-pomodoro-session.spec.ts` drops the tests of removed behaviour:
  - logout saving a pomodoro, and the save queue, retries and reconciliation of uncertain POSTs;
  - unsaved counts, the Web Lock, the two-tab save handoff, and refused storage.
  It keeps or adapts the tests of behaviour that still exists:
  - a one-minute session keeping its entry fields, skipping phases, counting overtime and leaving preferences unchanged;
  - the nav marker;
  - transition sounds, the alarm looping until an action, rejected audio with retry, and notifications;
  - a session start stopping the regular timer at its start;
  - a timer start ending the session and saving the partial pomodoro;
  - a remote timer ending the session;
  - the too-short notice.
- [ ] `e2e/timer-pause.spec.ts` drops the tests of local chain storage (full storage, reload persistence, the other tab's chain) and keeps or adapts:
  - Pause freezing the total, Resume cloning the entry, and Stop ending the chain;
  - Stop pressed during Pause or Resume;
  - a timer started on another client ending the chain;
  - the layout fit check.
- [ ] New two-context tests, both contexts signed in as the same user:
  - a session started in A shows in B (Pomodoro page and banner) within 2 s with no reload;
  - Next phase confirmed in B while both ring stops A's alarm;
  - a second confirm in A with the old revision gets 409, advances nothing, and A shows the refreshed state with the conflict message;
  - Pause in A shows Paused with the same total in B, and Resume in B shows the clone running in A.
- [ ] Each test asserts the stored entries through the API where the old one did: one snapped stopped entry per pomodoro, and the trash for a too-short one.
- [ ] `e2e/settings-pomodoro.spec.ts`, `e2e/visual.spec.ts`, `e2e/pages.spec.ts`, `e2e/helpers.ts` and `e2e/fixtures.ts` are updated only where they depend on removed local storage or behaviour.
- [ ] `npm run test:e2e` exits 0. `tsc -p e2e/tsconfig.json` (part of `npm run typecheck`) exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Use the existing fixtures (`e2e/fixtures.ts`: worker accounts, the reset fixture, the error guard) and helpers. Read `.ai/kenkeep/nodes/tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md` first.
- The server sets action instants, so a fake browser clock cannot move the server. The web takes its clock offset again from each state's `server_time`. Advance a fake browser clock only after the last state has arrived, or wait a real minute for the one test that needs a real planned end. Keep the suite's runtime close to today's.
- Two contexts: `browser.newContext()` with the same storage state, or sign in twice.
- No plan or ticket references in test names or comments.

## Input Dependencies
- Task 5: the server-driven Pomodoro UI.
- Task 6: the server-driven pause chain.
- Tasks 1 to 3: the server behaviour the tests drive.

## Output Artifacts
Green e2e specs that cover cross-device sync. They are the automated form of the plan's browser self-validation.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read both specs in full before editing. For each test, decide whether its behaviour still exists (keep or adapt it) or was removed (delete it). Do not keep a test by weakening its assertion.
2. Long runs: start Playwright detached so a harness restart does not kill it. For example `setsid nohup npm run test:e2e > "$tmp/e2e.log" 2>&1 &`, then follow the log.
3. To prove the 2 s claim, use the SSE stream, not focus refetch. Do not focus context B while waiting. Assert with `expect(...).toBeVisible({ timeout: 2000 })` after the action in A resolves.
4. The 409 case: get both contexts ringing on the same phase. Block A's next request with `page.route` until B's next has finished, then release it.
5. Run single specs while working (`npx playwright test e2e/timer-pause.spec.ts`), then the whole suite once at the end.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into one test where they share setup.
</details>
