---
id: 4
group: "web-client"
dependencies: [3]
status: "completed"
created: 2026-10-27
skills:
  - react
  - tanstack-query
complexity_score: 5
execution_profile: "standard-implementation"
---
# Web timer state stream and action hooks

## Objective
Give the web app one source of truth for the timer. A provider opens the SSE stream for the signed-in account, writes each state into TanStack Query, falls back to polling while the stream is down, and exposes the server-corrected clock and hooks for the six actions.

## Skills Required
React and TanStack Query, plus the browser `EventSource` API.

## Acceptance Criteria
- [ ] A provider (for example `packages/web/src/api/TimerStateProvider.tsx`) is mounted in `packages/web/src/App.tsx` for a signed-in account. It opens `new EventSource('/api/app/timer/events')` and, on every `timer` event:
  - writes the state under a new `keys.timer` query key;
  - writes `state.running_entry` into the `keys.current` cache.
  A state with a lower revision than the cached one is dropped.
- [ ] `useTimerState()` reads `GET /api/app/timer`. It polls every 30 s only while the stream is down, and refetches on window focus and when the stream reconnects. While the stream is up, `useCurrentEntry()` in `packages/web/src/api/hooks.ts` stops its own 30 s poll.
- [ ] The provider keeps a clock offset, `Date.parse(state.server_time) - Date.now()`, taken when each state arrives. `useServerNow()` (or an equivalent) returns the corrected time and ticks like `useNow()` in `packages/web/src/lib/settings.ts`.
- [ ] Action hooks `useStartPomodoro`, `useNextPhase`, `useEndPomodoro`, `usePauseTimer`, `useResumeTimer` and `useDiscardPause` POST to the task 3 routes. Next, End, Resume and Discard send the cached `revision`.
  - On success, the returned state goes into the cache.
  - On 409, the state in the body goes into the cache, and the hook reports "Another device changed the timer first."
  - With no network, the hook reports "Can't reach the server. Try again when you're back online."
- [ ] The v9 start, stop and edit mutations also invalidate `keys.timer`, so the state refreshes while the stream is down.
- [ ] Signing out closes the stream, because the provider unmounts with the account.
- [ ] A unit test covers the pure parts: dropping a lower revision, deriving the current entry from a state, and the offset math.
- [ ] `npm test --workspace packages/web` (or `npm test`) and `npm run typecheck` exit 0.
- [ ] Manual check: build and run the app (`npm run build && npm start`), sign in in a browser, and start a timer with `curl` against `/api/v9/workspaces/:wid/time_entries`. The web timer bar shows it within 2 s with no reload.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- `TimerState` comes from `@tokkl/types` (task 2), re-exported through `packages/web/src/api/types.ts`.
- Use the existing `api` client in `packages/web/src/api/client.ts` for requests and its error shape for 409 and network errors. Read how it raises errors before writing the hooks.
- Same-origin `EventSource` sends the session cookie. The CSP's `connect-src 'self'` allows it.
- Follow the existing hook style in `packages/web/src/api/hooks.ts`: the `keys` object, `useQuery` and `useMutation`.
- No plan or ticket references in code, comments or test names.

## Input Dependencies
Task 3: `GET /api/app/timer`, the action routes and the SSE stream. Task 2: `TimerState` in `@tokkl/types`.

## Output Artifacts
- The provider, `useTimerState`, `useServerNow` and the six action hooks, which the Pomodoro views (task 5) and the timer bar (task 6) use.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `packages/web/src/api/hooks.ts`, `client.ts` and `packages/web/src/main.tsx`, which sets the QueryClient defaults (focus refetch is throttled there). Also read `App.tsx` around line 343, where providers are mounted.
2. Mount the provider inside the signed-in shell, keyed by account id the way `PomodoroSessionProvider` keys `AccountSession`, so switching accounts reopens the stream.
3. EventSource lifecycle:
   - `onopen` sets `streaming = true`;
   - `onerror` sets `streaming = false`, and the browser reconnects by itself;
   - the `timer` listener runs `JSON.parse(event.data)` and then `merge(state)`;
   - close it in the effect cleanup.
4. Polling fallback: `useQuery({ queryKey: keys.timer, queryFn, refetchInterval: streaming ? false : 30_000 })`. Keep `streaming` in React state or a small store that `useCurrentEntry` can read too.
5. `merge(state)`:
   - if the cached revision is higher, ignore the state;
   - otherwise `setQueryData(keys.timer, state)` and `setQueryData(keys.current, state.running_entry)`;
   - record the offset.
   Put `merge` in a pure module so the unit test needs no React.
6. Offset caveat for the e2e work in task 7: the offset is taken again on every state, so a fake browser clock advanced after the last state still moves the corrected time forward.
7. Messages: keep the two strings in one place so task 5 and task 6 show the same words.

Test philosophy: write a few tests, mostly integration. Test custom business logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD without custom logic, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Combine related scenarios into a few test functions.
</details>
