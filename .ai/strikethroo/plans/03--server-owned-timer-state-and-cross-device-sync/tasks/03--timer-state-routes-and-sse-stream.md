---
id: 3
group: "api-timer-state"
dependencies: [2]
status: "completed"
created: 2026-10-27
skills:
  - node-http
  - server-sent-events
complexity_score: 6
complexity_notes: "The REST routes are thin, but the SSE stream has its own lifecycle: auth rechecks, keep-alive, a per-user cap and closing on shutdown. These share one stream registry, so they stay in one task."
execution_profile: "complex-architecture"
---
# Timer state routes and SSE stream

## Objective
Expose the timer state and its actions under `/api/app`, and push the full state to every open stream of a user on each change.

## Skills Required
Express 5 routing and Node HTTP streaming responses (Server-Sent Events).

## Acceptance Criteria
- [ ] Routes under `/api/app`, all behind `requireAuth`, so the session cookie, an API token and a password all work:
  - `GET /timer` returns `getTimerState`;
  - `POST /timer/pause`, `POST /timer/resume`, `POST /timer/discard`;
  - `POST /pomodoro` (start), `POST /pomodoro/next`, `POST /pomodoro/end`.
  Actions read a JSON body (`revision` where task 2 needs it) and return the new state. A refusal returns 409 with the current state as the JSON body. A cookie-authenticated POST without the CSRF header gets 403, as other `/api/app` writes do.
- [ ] `GET /timer/events` is an SSE stream:
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`. The headers are flushed at once.
  - On connect it sends `event: timer` with the full state as `data`. After that it sends one such event on every hub publish for the user.
  - A comment line (`: keep-alive`) goes out every 25 s.
  - `stillSignedIn` runs before each send and on each keep-alive tick. The stream ends when it fails.
  - Logout, API token rotation, password change, password reset and account suspension recheck that user's streams at once.
  - At most 10 streams per user. Opening one more closes the oldest.
  - A client disconnect unsubscribes and clears the timer.
- [ ] Shutdown in `packages/api/src/index.ts` closes every open stream, so `server.close()` completes.
- [ ] `packages/api/test/timerRoutes.test.ts` covers:
  - `GET /timer` with Basic token auth and with a cookie;
  - a cookie POST without the CSRF header getting 403;
  - a full session over HTTP with increasing revisions, and a stale `next` getting 409 with a state body;
  - the stream's first event being the idle state;
  - a v9 start through another request arriving as an event with a higher revision;
  - a keep-alive comment arriving;
  - the stream closing after cookie logout, and after token rotation for a Basic stream;
  - the oldest stream closing when one too many are open.
- [ ] `npm test --workspace packages/api` and `npm run typecheck` exit 0.
- [ ] Manual check: with the API running (`npm start`), `curl -N -u "$TOKEN:api_token" http://localhost:PORT/api/app/timer/events` prints an `event: timer` block at once and a `: keep-alive` line within 25 s.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- No new dependency and no compression middleware.
- Write the stream with `res.write`. Express's JSON error handler must not run after the headers are sent.
- The keep-alive interval and the per-user cap are parameters of the route factory (or of the stream registry), with 25 s and 10 as the production defaults. Tests pass small values. Do not branch on environment.
- The SSE data line holds one line of JSON (`JSON.stringify` without indentation), so no multi-line `data:` handling is needed.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 2: `getTimerState`, the actions and the 409 error that carries a state. Task 1: the hub.

## Output Artifacts
The HTTP contract that the web (task 4), the desktop core (task 8) and the docs (task 15) build on.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `packages/api/src/routes/app.ts` (how routes take `deps`, `requireAuth`, `readJson`) and `packages/api/src/auth/middleware.ts` (`stillSignedIn`, `res.locals.authMethod`, CSRF). Add the routes either to `app.ts` or to a new `routes/timer.ts` mounted from `packages/api/src/app.ts` under `/api/app`.
2. Map each action's 409 error to `res.status(409).json(state)`. Other errors keep going through `errorHandler`.
3. Stream registry (for example `packages/api/src/services/timerStreams.ts`):
   - `open(userId, res, check: () => boolean)` subscribes to the hub, sends the first state and starts the keep-alive interval;
   - each send runs `check()` first and ends the response when it fails;
   - `recheck(userId)` runs `check()` on that user's streams;
   - `closeAll()` is for shutdown;
   - it tracks streams per user in insertion order, so the oldest is closed when the cap is exceeded.
4. `check` is `() => stillSignedIn(db, res.locals, user)`. Read `res.locals` at connect time and keep them.
5. Call `recheck(userId)` from the logout route, the API token reset route (find it with `grep -rn "api_token" packages/api/src/routes`), password change and reset (`packages/api/src/models/accountTokens.ts`, `routes/app.ts`), and account suspension in `routes/admin.ts`. Use grep to find each place.
6. On each hub publish, read a fresh `getTimerState` per stream. Every stream of one user gets the same state, so build it once per publish.
7. In `index.ts`, call `closeAll()` before `server.close()` in the shutdown handler.
8. Tests: use `testServer` from `packages/api/test/helpers.ts`. Read the stream with `fetch` and `response.body.getReader()`. Decode chunks and split on blank lines. Abort with an `AbortController` at the end of each test so the server can close.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
