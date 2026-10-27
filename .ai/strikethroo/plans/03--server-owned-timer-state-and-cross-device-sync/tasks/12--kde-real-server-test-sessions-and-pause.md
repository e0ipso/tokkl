---
id: 12
group: "desktop-platforms"
dependencies: [11]
status: "pending"
created: 2026-10-27
skills:
  - cpp-qt
  - typescript
complexity_score: 5
execution_profile: "standard-implementation"
---
# KDE real-server test: sessions, pause and the stream

## Objective
Extend the KDE companion's real-server test so it runs a Pomodoro session and a pause chain against a real Tokkl server, checks the stored entries, and proves a change made on the server reaches the companion through the SSE stream.

## Skills Required
C++ with Qt Test for `realservertest.cpp`, and TypeScript for the Node runner `realserver.test.ts`.

## Acceptance Criteria
- [ ] `desktop/kde/tests/realservertest.cpp` adds cases that:
  - start a session, confirm Next phase twice, then End session;
  - pause, resume, pause again and discard;
  - see a session started through the API by the runner appear in the companion within 2 s, with the stream up and no poll;
  - hold a pause reply at the proxy, drop it, and confirm no second POST was sent and the next state settles the result.
- [ ] `desktop/kde/tests/realserver.test.ts`:
  - its proxy passes SSE responses through unbuffered and lets the hold and release control work on POSTs while a stream is open;
  - its end-of-run data checks expect one snapped stopped entry per pomodoro, the resumed clones, and nothing else changed;
  - the control server gains any hook the new cases need, for example "start a session for user X".
- [ ] `desktop/kde/ci/realserver.sh --format deb --output "$(mktemp -d)"` exits 0. So does `node --test desktop/kde/tests/realserver.test.ts` with `TOKKL_KDE_REALSERVER_COMMAND` pointing at a local build, as the file header describes.
- [ ] `tsc -p desktop/kde/tests/tsconfig.json` (part of `npm run typecheck`) exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read the header comment of `realserver.test.ts` and `desktop/kde/ci/realserver.sh` first. The proxy holds replies back, so it must not wait for a stream's end before forwarding its bytes.
- Set the instance resolution to 1 minute in the fixture so snapped spans are predictable, if the fixture does not already.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 11: the KDE companion on the new core.
- Tasks 1 to 3: the server endpoints and stream.

## Output Artifacts
A real-server test that covers sessions, pause and SSE push. It is the automated form of the plan's KDE self-validation step.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `realservertest.cpp` to see how existing cases drive `TimerController` and ask the control server to hold replies. Add the new cases in the same style.
2. Proxy streaming: when the upstream response has `content-type: text/event-stream`, pipe it straight to the client (`upstream.pipe(res)`) and never hold it. Holding applies to ordinary requests only.
3. Timing: use `QTRY_VERIFY_WITH_TIMEOUT` with 2000 ms for the push case.
4. Long runs: `realserver.sh` builds images. Run it detached (`setsid nohup ... &`) and follow the log.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
