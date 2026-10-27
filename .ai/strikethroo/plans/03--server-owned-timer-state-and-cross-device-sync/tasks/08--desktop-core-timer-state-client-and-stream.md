---
id: 8
group: "desktop-core"
dependencies: [3]
status: "completed"
created: 2026-10-27
skills:
  - cpp-qt
  - qt-network
complexity_score: 6
complexity_notes: "Adds a streaming request to the Transport abstraction and its fake, a strict decoder and a client with reconnect and poll fallback. The three only make sense together and are tested together through the fake transport. TimerController and PomodoroSession move onto it in tasks 9 and 10."
execution_profile: "complex-architecture"
---
# Desktop core: timer state client and SSE stream

## Objective
Add a core component that reads `GET /api/app/timer`, holds the SSE stream, keeps the latest state and the server clock offset, falls back to polling while the stream is down, and sends the six timer actions. KDE, GNOME and macOS share it.

## Skills Required
C++20 with Qt 6 Core and Qt Network (`QNetworkAccessManager`, streaming reads from `QNetworkReply`).

## Acceptance Criteria
- [x] `Transport` in `desktop/core/src/transport.h` gains a streaming request, for example `virtual PendingStream *openStream(const HttpRequest &)`. The stream emits `dataReceived(QByteArray)` for each chunk and `finished(HttpResponse)` once. `NetworkTransport` implements it on `QNetworkReply::readyRead`. It has no overall timeout. Instead it has an idle timeout of 60 s with no bytes, which is more than twice the server's 25 s keep-alive. The fake transport in `desktop/core/autotests/fakes.h` can script chunks and a close.
- [x] `apitypes.h/.cpp` gain `TimerState` and `decodeTimerState()`, mirroring task 2's JSON. They follow the existing strict decode style and return `std::nullopt` for a malformed state.
- [x] `Connection` gains typed operations that use its generation and authorization:
  - `fetchTimerState`;
  - one per action: pause, resume, discard, start session, next phase and end session;
  - `openTimerEvents()`.
  An action's callback can tell three outcomes apart: success with a state, a 409 with the server's state, and an unknown outcome (no answer, timeout, 5xx, unreadable body).
- [x] A new `TimerStateClient` QObject (`timerstateclient.h/.cpp`) takes the `Connection`, the `Transport` path through it, and the `Clock`. It:
  - reads the state when a context becomes Connected and opens the stream;
  - parses SSE across chunk boundaries (`event:` and `data:` lines, a blank line ending an event, `:` comment lines ignored);
  - emits `stateChanged()` for each state with a revision at least as new as the one it holds;
  - exposes `state()`, `streaming()`, `serverOffsetMs()` and `serverNow()`;
  - reconnects with backoff from 1 s, doubling up to 60 s, after a stream ends or fails;
  - while the stream is down, reads the state every 30 s and on `resumed()`;
  - drops its state when the generation changes.
- [x] Actions sent through the client adopt the returned state, on success and on 409.
- [x] A new CTest test, `timerstateclienttest.cpp`, uses the fake transport and fake clock. It covers:
  - the first read and the stream opening;
  - an event split across two chunks;
  - keep-alive comments ignored;
  - a lower revision ignored;
  - a stream close switching to the 30 s poll and then reconnecting;
  - a generation change dropping the state;
  - a 409 adopting the server's state;
  - the offset taken from `server_time`.
- [x] The core still links only Qt Core and Qt Network. `desktop/core/ci/check.sh` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Read `desktop/core/src/transport.h/.cpp`, `connection.h/.cpp` (generation, `send`, `Access`, cooldown handling) and `apitypes.h/.cpp` before designing. A 429 cooldown and authentication failures must behave as they do for other requests.
- The Authorization header is never logged.
- Words stay out of core except the existing message paths. Platforms format the text.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 3: the routes, the 409 body and the SSE format. Task 2: the JSON shape of `TimerState`.

## Output Artifacts
`TimerStateClient`, `TimerState` and the new `Connection` operations. `TimerController` (task 9), `PomodoroSession` (task 10) and every platform (tasks 11, 13 and 14) use them.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. `PendingStream` sits next to `PendingReply` in `transport.h`. Give it `abort()`, `dataReceived(const QByteArray &)` and `finished(const Tokkl::HttpResponse &)`. The response status matters: a 401 or 403 on the stream follows `Connection`'s auth handling.
2. In `NetworkTransport`, set the request's `Accept: text/event-stream` header and the transfer timeout to 0 (none). Restart a `QTimer` on every `readyRead`. When it fires, abort with `Outcome::Timeout`.
3. SSE parser: keep a `QByteArray` buffer. Split complete events on `\n\n`, and accept `\r\n` too. For each event, collect the `data:` lines and the `event:` name. Only `timer` events carry a state.
4. Offset: `serverOffsetMs = server_time - clock.now()` when a state arrives. `serverNow() = clock.now() + offset`.
5. Polling: reuse the 30 s cadence (`TimerController::pollIntervalMs` today; move the constant if task 9 needs it). Only poll while `!streaming()`.
6. Revision guard: within one generation, keep the highest revision. A new generation resets it.
7. Tests: follow `timercontrollertest.cpp` for fixtures. The fake clock's `ticked()` drives the poll. Add stream support to the fake transport so existing tests keep compiling.
8. Run `desktop/core/ci/check.sh` at the end.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
